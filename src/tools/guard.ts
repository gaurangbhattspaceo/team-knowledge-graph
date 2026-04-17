import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const guardSchema = z.object({
  description: z.string().describe('What you are about to build or change'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional().describe('Feature patterns like chat-ui, voice, payment, onboarding'),
});

export type GuardInput = z.infer<typeof guardSchema>;

interface GuardRule {
  type: string;
  id: string;
  title: string;
  severity: string;
  scope: string;
  platforms: string[];
  patterns: string[];
  source_name: string;
  repeat_count: number;
  enforcement: string;
}

interface GuardResult {
  rules: GuardRule[];
  repeated_warnings: GuardRule[];
  total: number;
}

/** Convert neo4j integer or plain number to JS number */
function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val && typeof (val as any).toNumber === 'function') return (val as any).toNumber();
  return 0;
}

const SEVERITY_ORDER: Record<string, number> = {
  'must': 0,
  'should': 1,
  'nice-to-have': 2,
};

export async function guard(input: GuardInput, repo: RepoInfo | null): Promise<GuardResult> {
  const session = getSession();

  try {
    const products = input.products ?? [];
    const platforms = input.platforms ?? [];
    const patterns = input.patterns ?? [];

    // Query all active DesignRules, PlatformRules, and Rules
    // Include global scope rules always, plus product-matching rules via APPLIES_TO
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
         COALESCE(n.scope, 'product') AS scope,
         COALESCE(n.platforms, []) AS platforms,
         COALESCE(n.patterns, []) AS patterns,
         COALESCE(n.source_name, '') AS source_name,
         COALESCE(n.repeat_count, 1) AS repeat_count,
         COALESCE(n.enforcement, 'automated') AS enforcement`,
      { products, platforms }
    );

    let rules: GuardRule[] = result.records.map((record) => ({
      type: record.get('type'),
      id: record.get('id'),
      title: record.get('title'),
      severity: record.get('severity'),
      scope: record.get('scope'),
      platforms: record.get('platforms'),
      patterns: record.get('patterns'),
      source_name: record.get('source_name'),
      repeat_count: toNum(record.get('repeat_count')),
      enforcement: record.get('enforcement'),
    }));

    // Post-filter by patterns if provided
    if (patterns.length > 0) {
      rules = rules.filter((r) => {
        // Always include global scope rules
        if (r.scope === 'global') return true;
        // Include rules with no patterns
        if (!r.patterns || r.patterns.length === 0) return true;
        // Include rules with matching patterns
        return r.patterns.some((p) => patterns.includes(p));
      });
    }

    // Sort by repeat_count DESC, then severity (must > should > nice-to-have)
    rules.sort((a, b) => {
      if (b.repeat_count !== a.repeat_count) return b.repeat_count - a.repeat_count;
      return (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    });

    const repeatedWarnings = rules.filter((r) => r.repeat_count >= 2);

    return {
      rules,
      repeated_warnings: repeatedWarnings,
      total: rules.length,
    };
  } finally {
    await session.close();
  }
}
