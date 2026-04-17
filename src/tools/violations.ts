import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const violationsSchema = z.object({
  action: z.enum(['record', 'query']).describe('record a new violation or query existing ones'),
  rule_id: z.string().optional().describe('ID of the violated rule (for record)'),
  repo: z.string().optional(),
  product: z.string().optional(),
  platform: z.string().optional(),
  detected_by: z.enum(['ci', 'review', 'repeated-feedback', 'guard']).optional(),
  scope: z.enum(['repo', 'product', 'global']).optional().describe('Filter scope for query'),
});

export type ViolationsInput = z.infer<typeof violationsSchema>;

interface RecordResult {
  violation_id: string;
  new_repeat_count: number;
  escalated_to: string | null;
}

interface ViolationRecord {
  id: string;
  rule_id: string;
  rule_title: string;
  repo: string;
  product: string;
  platform: string;
  detected_by: string;
  date: string;
}

interface QueryResult {
  violations: ViolationRecord[];
  total: number;
}

export async function violations(
  input: ViolationsInput,
  repo: RepoInfo | null
): Promise<RecordResult | QueryResult> {
  const session = getSession();

  try {
    if (input.action === 'record') {
      if (!input.rule_id) {
        throw new Error('rule_id is required for record action');
      }

      const violationId = generateId();
      const date = new Date().toISOString().split('T')[0];

      // Create Violation node and link to rule via VIOLATES
      await session.run(
        `CREATE (v:Violation {
          id: $id,
          rule_id: $rule_id,
          repo: $repo,
          product: $product,
          platform: $platform,
          detected_by: $detected_by,
          resolved: false,
          date: $date,
          createdBy: $createdBy
        })
        WITH v
        MATCH (r {id: $rule_id})
        CREATE (v)-[:VIOLATES]->(r)`,
        {
          id: violationId,
          rule_id: input.rule_id,
          repo: input.repo ?? (repo?.name ?? null),
          product: input.product ?? null,
          platform: input.platform ?? null,
          detected_by: input.detected_by ?? null,
          date,
          createdBy: 'ai-agent',
        }
      );

      // Increment repeat_count and update last_violated on the rule, then auto-escalate
      const updateResult = await session.run(
        `MATCH (r {id: $rule_id})
         SET r.repeat_count = coalesce(r.repeat_count, 0) + 1,
             r.last_violated = $date
         WITH r,
              coalesce(r.repeat_count, 1) AS new_count
         SET r.severity = CASE WHEN new_count >= 2 THEN 'must' ELSE r.severity END,
             r.enforcement = CASE WHEN new_count >= 3 THEN 'ci-gate' ELSE r.enforcement END
         RETURN r.repeat_count AS repeat_count, r.enforcement AS enforcement, r.severity AS severity`,
        { rule_id: input.rule_id, date }
      );

      let newRepeatCount = 1;
      let escalatedTo: string | null = null;

      if (updateResult.records.length > 0) {
        const record = updateResult.records[0];
        const raw = record.get('repeat_count');
        newRepeatCount = typeof raw === 'number' ? raw :
          (raw && typeof raw.toNumber === 'function') ? raw.toNumber() : 1;

        const enforcement = record.get('enforcement');
        const severity = record.get('severity');

        if (newRepeatCount >= 3 && enforcement === 'ci-gate') {
          escalatedTo = 'ci-gate';
        } else if (newRepeatCount >= 2 && severity === 'must') {
          escalatedTo = 'severity:must';
        }
      }

      return {
        violation_id: violationId,
        new_repeat_count: newRepeatCount,
        escalated_to: escalatedTo,
      };
    } else {
      // query action
      let whereClause = '';
      const params: Record<string, string> = {};

      if (input.scope === 'repo' && (input.repo ?? repo?.name)) {
        whereClause = 'WHERE v.repo = $repo';
        params.repo = input.repo ?? repo?.name ?? '';
      } else if (input.scope === 'product' && input.product) {
        whereClause = 'WHERE v.product = $product';
        params.product = input.product;
      }

      const queryResult = await session.run(
        `MATCH (v:Violation)-[:VIOLATES]->(r)
         ${whereClause}
         RETURN v.id AS id,
                v.rule_id AS rule_id,
                coalesce(r.title, '') AS rule_title,
                coalesce(v.repo, '') AS repo,
                coalesce(v.product, '') AS product,
                coalesce(v.platform, '') AS platform,
                coalesce(v.detected_by, '') AS detected_by,
                v.date AS date
         ORDER BY v.date DESC
         LIMIT 50`,
        params
      );

      const violationsList: ViolationRecord[] = queryResult.records.map((rec) => ({
        id: rec.get('id'),
        rule_id: rec.get('rule_id'),
        rule_title: rec.get('rule_title'),
        repo: rec.get('repo'),
        product: rec.get('product'),
        platform: rec.get('platform'),
        detected_by: rec.get('detected_by'),
        date: rec.get('date'),
      }));

      return {
        violations: violationsList,
        total: violationsList.length,
      };
    }
  } finally {
    await session.close();
  }
}
