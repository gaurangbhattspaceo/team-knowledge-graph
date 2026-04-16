import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

const ruleItemSchema = z.object({
  title: z.string(),
  type: z.enum(['design', 'platform', 'business']),
  severity: z.enum(['must', 'should', 'nice-to-have']).optional().default('must'),
  scope: z.enum(['global', 'product', 'feature', 'screen']).optional().default('product'),
  patterns: z.array(z.string()).optional(),
});

export const ingestSchema = z.object({
  source: z.string().describe('Name of the person giving feedback'),
  role: z.enum(['founder', 'csm', 'client', 'engineer', 'user']),
  feedback: z.string().describe('Raw feedback text'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  rules: z.array(ruleItemSchema).optional().describe('Pre-decomposed rules. If omitted, feedback stored for later decomposition.'),
});

export type IngestInput = z.infer<typeof ingestSchema>;

interface RepeatDetail {
  rule_id: string;
  title: string;
  repeat_count: number;
}

interface IngestResult {
  feedback_id: string;
  rules_created: number;
  rules_repeated: number;
  rule_ids: string[];
  repeat_details: RepeatDetail[];
  needs_decomposition: boolean;
}

const LABEL_MAP: Record<string, string> = {
  design: 'DesignRule',
  platform: 'PlatformRule',
  business: 'Rule',
};

export async function ingest(input: IngestInput, repo: RepoInfo | null): Promise<IngestResult> {
  const feedbackId = generateId();
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();

  try {
    // 1. Create Feedback node
    await session.run(
      `CREATE (f:Feedback {
        id: $id,
        source: $source,
        role: $role,
        feedback: $feedback,
        date: $date,
        createdBy: $createdBy
      })`,
      {
        id: feedbackId,
        source: input.source,
        role: input.role,
        feedback: input.feedback,
        date,
        createdBy: 'ai-agent',
      }
    );

    // 2. Create/merge Person node and link via GAVE
    await session.run(
      `MERGE (p:Person {name: $name})
       ON CREATE SET p.role = $role
       WITH p
       MATCH (f:Feedback {id: $feedbackId})
       CREATE (p)-[:GAVE]->(f)`,
      { name: input.source, role: input.role, feedbackId }
    );

    // 3. Link to Repo via DISCOVERED_IN
    if (repo) {
      await session.run(
        `MERGE (r:Repo {url: $url}) SET r.name = $name
         WITH r
         MATCH (f:Feedback {id: $feedbackId})
         CREATE (f)-[:DISCOVERED_IN]->(r)`,
        { url: repo.url, name: repo.name, feedbackId }
      );
    }

    // If no rules provided, return early with needs_decomposition
    if (!input.rules || input.rules.length === 0) {
      return {
        feedback_id: feedbackId,
        rules_created: 0,
        rules_repeated: 0,
        rule_ids: [],
        repeat_details: [],
        needs_decomposition: true,
      };
    }

    // 4. Process each rule
    let rulesCreated = 0;
    let rulesRepeated = 0;
    const ruleIds: string[] = [];
    const repeatDetails: RepeatDetail[] = [];

    for (const ruleItem of input.rules) {
      const label = LABEL_MAP[ruleItem.type];
      let existingRuleId: string | null = null;
      let existingRepeatCount = 1;

      // Fulltext search for repeats
      try {
        const searchTerms = ruleItem.title.split(' ').slice(0, 5).join(' ') + '*';
        const searchResult = await session.run(
          `CALL db.index.fulltext.queryNodes('knowledge_search', $searchTerms) YIELD node, score
           WHERE score > 2.0 AND $label IN labels(node)
           RETURN node.id AS id, node.title AS title, node.repeat_count AS repeat_count, score
           ORDER BY score DESC
           LIMIT 1`,
          { searchTerms, label }
        );

        if (searchResult.records.length > 0) {
          const record = searchResult.records[0];
          existingRuleId = record.get('id');
          const rawCount = record.get('repeat_count');
          existingRepeatCount = typeof rawCount === 'number' ? rawCount :
            (rawCount && typeof rawCount.toNumber === 'function') ? rawCount.toNumber() : 1;
        }
      } catch {
        // fulltext index may not exist yet — skip silently
      }

      if (existingRuleId) {
        // Repeat detected
        const newRepeatCount = existingRepeatCount + 1;
        rulesRepeated++;
        ruleIds.push(existingRuleId);

        // Auto-escalate severity and enforcement
        const updates: string[] = [`n.repeat_count = $newRepeatCount`];
        if (newRepeatCount >= 2) {
          updates.push(`n.severity = 'must'`);
        }
        if (newRepeatCount >= 3) {
          updates.push(`n.enforcement = 'ci-gate'`);
        }

        await session.run(
          `MATCH (n {id: $ruleId}) SET ${updates.join(', ')}`,
          { ruleId: existingRuleId, newRepeatCount }
        );

        // Create Violation node
        const violationId = generateId();
        await session.run(
          `CREATE (v:Violation {
            id: $violationId,
            detected_by: 'repeated-feedback',
            date: $date,
            createdBy: $createdBy
          })
          WITH v
          MATCH (n {id: $ruleId})
          CREATE (v)-[:VIOLATES]->(n)`,
          { violationId, date, createdBy: 'ai-agent', ruleId: existingRuleId }
        );

        // Link feedback to existing rule via GENERATED
        await session.run(
          `MATCH (f:Feedback {id: $feedbackId})
           MATCH (n {id: $ruleId})
           CREATE (f)-[:GENERATED]->(n)`,
          { feedbackId, ruleId: existingRuleId }
        );

        repeatDetails.push({
          rule_id: existingRuleId,
          title: ruleItem.title,
          repeat_count: newRepeatCount,
        });
      } else {
        // New rule
        const ruleId = generateId();
        rulesCreated++;
        ruleIds.push(ruleId);

        // Neo4j doesn't support parameterized labels, so use string interpolation.
        // Safe because label comes from fixed LABEL_MAP.
        await session.run(
          `CREATE (n:${label} {
            id: $id,
            title: $title,
            detail: null,
            severity: $severity,
            scope: $scope,
            platforms: $platforms,
            patterns: $patterns,
            source_name: $sourceName,
            source_role: $sourceRole,
            source_date: $sourceDate,
            enforcement: 'automated',
            repeat_count: 1,
            last_violated: null,
            date: $date,
            createdBy: $createdBy,
            confidence: 'explicit',
            status: 'active'
          })`,
          {
            id: ruleId,
            title: ruleItem.title,
            severity: ruleItem.severity || 'must',
            scope: ruleItem.scope || 'product',
            platforms: input.platforms || [],
            patterns: ruleItem.patterns || [],
            sourceName: input.source,
            sourceRole: input.role,
            sourceDate: date,
            date,
            createdBy: 'ai-agent',
          }
        );

        // Link feedback to new rule via GENERATED
        await session.run(
          `MATCH (f:Feedback {id: $feedbackId})
           MATCH (n {id: $ruleId})
           CREATE (f)-[:GENERATED]->(n)`,
          { feedbackId, ruleId }
        );

        // Link to products via APPLIES_TO
        if (input.products && input.products.length > 0) {
          for (const productName of input.products) {
            await session.run(
              `MERGE (p:Product {name: $name})
               WITH p
               MATCH (n {id: $ruleId})
               CREATE (n)-[:APPLIES_TO]->(p)`,
              { name: productName, ruleId }
            );
          }
        }
      }
    }

    return {
      feedback_id: feedbackId,
      rules_created: rulesCreated,
      rules_repeated: rulesRepeated,
      rule_ids: ruleIds,
      repeat_details: repeatDetails,
      needs_decomposition: false,
    };
  } finally {
    await session.close();
  }
}
