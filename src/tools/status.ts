import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const statusSchema = z.object({
  scope: z.enum(['repo', 'global']).default('repo'),
});

export type StatusInput = z.infer<typeof statusSchema>;

function toNum(val: unknown): number {
  if (val !== null && typeof val === 'object' && 'toNumber' in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return Number(val) || 0;
}

interface StatusResult {
  repo: string | null;
  scope: string;
  counts: {
    decisions: number;
    constraints: number;
    rules: number;
    products: number;
    relationships: number;
  };
  recent: Array<{ type: string; title: string; date: string }>;
}

export async function status(input: StatusInput, repo: RepoInfo | null): Promise<StatusResult> {
  const session = getSession();

  try {
    const useRepo = input.scope === 'repo' && repo !== null;

    // Build repo filter clause
    const repoFilter = useRepo
      ? `WHERE EXISTS { (n)-[:DISCOVERED_IN]->(:Repo {url: $repoUrl}) }`
      : '';
    const repoParam = { repoUrl: repo?.url ?? '' };

    // Count Decision nodes
    const decResult = await session.run(
      `MATCH (n:Decision) ${repoFilter} RETURN count(n) AS cnt`,
      repoParam
    );
    const decisions = toNum(decResult.records[0]?.get('cnt'));

    // Count Constraint nodes
    const conResult = await session.run(
      `MATCH (n:Constraint) ${repoFilter} RETURN count(n) AS cnt`,
      repoParam
    );
    const constraints = toNum(conResult.records[0]?.get('cnt'));

    // Count Rule nodes
    const ruleResult = await session.run(
      `MATCH (n:Rule) ${repoFilter} RETURN count(n) AS cnt`,
      repoParam
    );
    const rules = toNum(ruleResult.records[0]?.get('cnt'));

    // Count Product nodes (always global — products are shared)
    const prodResult = await session.run(
      `MATCH (p:Product) RETURN count(p) AS cnt`
    );
    const products = toNum(prodResult.records[0]?.get('cnt'));

    // Count relationship edges
    const relResult = await session.run(
      `MATCH ()-[r:RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->() RETURN count(r) AS cnt`
    );
    const relationships = toNum(relResult.records[0]?.get('cnt'));

    // 5 most recent entries
    const recentResult = await session.run(
      `MATCH (n)
       WHERE (n:Decision OR n:Constraint OR n:Rule)
       ${repoFilter}
       RETURN labels(n)[0] AS type, n.title AS title, n.date AS date
       ORDER BY n.date DESC
       LIMIT 5`,
      repoParam
    );
    const recent = recentResult.records.map((rec) => ({
      type: rec.get('type') as string,
      title: rec.get('title') as string,
      date: rec.get('date') as string,
    }));

    return {
      repo: repo?.name ?? null,
      scope: input.scope,
      counts: { decisions, constraints, rules, products, relationships },
      recent,
    };
  } finally {
    await session.close();
  }
}
