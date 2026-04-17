import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const traceSchema = z.object({
  rule_id: z.string().describe('ID of the rule to trace'),
});

export type TraceInput = z.infer<typeof traceSchema>;

interface TraceRule {
  id: string;
  title: string;
  type: string;       // DesignRule, PlatformRule, Rule
  severity: string;
  scope: string;
  platforms: string[];
  patterns: string[];
  enforcement: string;
  repeat_count: number;
  last_violated: string | null;
  date: string;
}

interface TraceOrigin {
  feedback_id: string;
  source_name: string;
  source_role: string;
  raw_text: string;
  date: string;
}

interface TraceResult {
  rule: TraceRule;
  origin: TraceOrigin[];
  violation_count: number;
  violations: Array<{ date: string; repo: string; detected_by: string }>;
  products: string[];
}

export async function trace(input: TraceInput, _repo: RepoInfo | null): Promise<TraceResult> {
  const session = getSession();

  try {
    // 1. Fetch the rule node (DesignRule, PlatformRule, or Rule)
    const ruleResult = await session.run(
      `MATCH (n)
       WHERE n.id = $id AND (n:DesignRule OR n:PlatformRule OR n:Rule)
       RETURN n,
              [l IN labels(n) WHERE l IN ['DesignRule', 'PlatformRule', 'Rule'] | l][0] AS nodeType`,
      { id: input.rule_id }
    );

    if (ruleResult.records.length === 0) {
      throw new Error(`Rule not found: ${input.rule_id}`);
    }

    const ruleRecord = ruleResult.records[0];
    const n = ruleRecord.get('n').properties;
    const nodeType = ruleRecord.get('nodeType') as string;

    // Parse repeat_count safely (Neo4j may return integer objects)
    const rawRepeatCount = n.repeat_count;
    const repeatCount: number =
      typeof rawRepeatCount === 'number'
        ? rawRepeatCount
        : rawRepeatCount && typeof rawRepeatCount.toNumber === 'function'
        ? rawRepeatCount.toNumber()
        : 1;

    const traceRule: TraceRule = {
      id: n.id ?? input.rule_id,
      title: n.title ?? '',
      type: nodeType,
      severity: n.severity ?? '',
      scope: n.scope ?? '',
      platforms: Array.isArray(n.platforms) ? n.platforms : [],
      patterns: Array.isArray(n.patterns) ? n.patterns : [],
      enforcement: n.enforcement ?? '',
      repeat_count: repeatCount,
      last_violated: n.last_violated ?? null,
      date: n.date ?? '',
    };

    // 2. Fetch connected Product nodes via APPLIES_TO
    const productsResult = await session.run(
      `MATCH (n {id: $id})-[:APPLIES_TO]->(p:Product)
       RETURN p.name AS name`,
      { id: input.rule_id }
    );
    const products: string[] = productsResult.records.map((r) => r.get('name') as string);

    // 3. Fetch connected Feedback nodes via GENERATED relationship
    //    Feedback-[:GENERATED]->Rule
    const originsResult = await session.run(
      `MATCH (f:Feedback)-[:GENERATED]->(n {id: $id})
       RETURN f.id AS feedback_id,
              coalesce(f.source, '') AS source_name,
              coalesce(f.role, '') AS source_role,
              coalesce(f.feedback, '') AS raw_text,
              coalesce(f.date, '') AS date`,
      { id: input.rule_id }
    );
    const origin: TraceOrigin[] = originsResult.records.map((r) => ({
      feedback_id: r.get('feedback_id') as string,
      source_name: r.get('source_name') as string,
      source_role: r.get('source_role') as string,
      raw_text: r.get('raw_text') as string,
      date: r.get('date') as string,
    }));

    // 4. Fetch connected Violation nodes via VIOLATES relationship
    //    Violation-[:VIOLATES]->Rule
    const violationsResult = await session.run(
      `MATCH (v:Violation)-[:VIOLATES]->(n {id: $id})
       RETURN coalesce(v.date, '') AS date,
              coalesce(v.repo, '') AS repo,
              coalesce(v.detected_by, '') AS detected_by
       ORDER BY v.date DESC`,
      { id: input.rule_id }
    );
    const violations = violationsResult.records.map((r) => ({
      date: r.get('date') as string,
      repo: r.get('repo') as string,
      detected_by: r.get('detected_by') as string,
    }));

    return {
      rule: traceRule,
      origin,
      violation_count: violations.length,
      violations,
      products,
    };
  } finally {
    await session.close();
  }
}
