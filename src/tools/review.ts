import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const reviewSchema = z.object({
  description: z.string().describe('What changed in this PR or diff'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  files_changed: z.array(z.string()).optional(),
});

export type ReviewInput = z.infer<typeof reviewSchema>;

interface ReviewRule {
  type: string;
  id: string;
  title: string;
  severity: string;
  enforcement: string;
  source_name: string;
  repeat_count: number;
}

interface ReviewResult {
  applicable_rules: ReviewRule[];
  total_applicable: number;
  ci_gates: ReviewRule[];
}

/** Convert neo4j integer or plain number to JS number */
function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val && typeof (val as any).toNumber === 'function') return (val as any).toNumber();
  return 0;
}

export async function review(input: ReviewInput, repo: RepoInfo | null): Promise<ReviewResult> {
  const session = getSession();

  try {
    const products = input.products ?? [];
    const platforms = input.platforms ?? [];

    // Query all active DesignRules, PlatformRules, and Rules for given products + platforms
    // Include global scope rules always
    // Match by platform using 'all' wildcard both ways (same logic as guard)
    const result = await session.run(
      `MATCH (n)
       WHERE (n:DesignRule OR n:PlatformRule OR n:Rule)
         AND COALESCE(n.status, 'active') = 'active'
         AND (
           COALESCE(n.scope, 'product') = 'global'
           OR (
             $products <> []
             AND EXISTS {
               MATCH (n)-[:APPLIES_TO]->(p:Product)
               WHERE p.name IN $products
             }
           )
           OR $products = []
         )
         AND (
           $platforms = []
           OR 'all' IN $platforms
           OR 'all' IN COALESCE(n.platforms, [])
           OR ANY(plat IN COALESCE(n.platforms, []) WHERE plat IN $platforms)
         )
       RETURN
         CASE
           WHEN n:DesignRule THEN 'DesignRule'
           WHEN n:PlatformRule THEN 'PlatformRule'
           ELSE 'Rule'
         END AS type,
         n.id AS id,
         n.title AS title,
         COALESCE(n.severity, 'should') AS severity,
         COALESCE(n.enforcement, 'automated') AS enforcement,
         COALESCE(n.source_name, '') AS source_name,
         COALESCE(n.repeat_count, 1) AS repeat_count`,
      { products, platforms }
    );

    let rules: ReviewRule[] = result.records.map((record) => ({
      type: record.get('type'),
      id: record.get('id'),
      title: record.get('title'),
      severity: record.get('severity'),
      enforcement: record.get('enforcement'),
      source_name: record.get('source_name'),
      repeat_count: toNum(record.get('repeat_count')),
    }));

    // Sort: ci-gate first, then by repeat_count DESC
    rules.sort((a, b) => {
      const aGate = a.enforcement === 'ci-gate' ? 0 : 1;
      const bGate = b.enforcement === 'ci-gate' ? 0 : 1;
      if (aGate !== bGate) return aGate - bGate;
      return b.repeat_count - a.repeat_count;
    });

    const ciGates = rules.filter((r) => r.enforcement === 'ci-gate');

    return {
      applicable_rules: rules,
      total_applicable: rules.length,
      ci_gates: ciGates,
    };
  } finally {
    await session.close();
  }
}
