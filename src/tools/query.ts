import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const querySchema = z.object({
  query: z.string(),
  type: z.enum(['decision', 'constraint', 'rule', 'all']).default('all'),
  product: z.string().optional(),
  limit: z.number().default(10),
});

export type QueryInput = z.infer<typeof querySchema>;

interface QueryResult {
  type: string;
  id: string;
  title: string;
  detail: string | null;
  products: string[];
  date: string;
  related: string[];
}

function escapeLucene(query: string): string {
  return query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

function labelFilter(type: string): string {
  if (type === 'decision') return 'n:Decision';
  if (type === 'constraint') return 'n:Constraint';
  if (type === 'rule') return 'n:Rule';
  return '(n:Decision OR n:Constraint OR n:Rule)';
}

export async function query(input: QueryInput, _repo: RepoInfo | null): Promise<{ results: QueryResult[] }> {
  const session = getSession();

  try {
    const escaped = escapeLucene(input.query);
    const searchQuery = escaped + '*';
    const productFilter = input.product
      ? `AND EXISTS { (n)-[:AFFECTS|GOVERNS|APPLIES_TO]->(:Product {name: $product}) }`
      : '';
    const labelCond = labelFilter(input.type);

    let records;

    try {
      // Fulltext search
      const cypher = `
        CALL db.index.fulltext.queryNodes('knowledge_search', $searchQuery) YIELD node AS n, score
        WHERE ${labelCond} ${productFilter}
        OPTIONAL MATCH (n)-[:AFFECTS|APPLIES_TO]->(p:Product)
        OPTIONAL MATCH (n)-[:USES|GOVERNS]->(t:Technology)
        OPTIONAL MATCH (n)-[:TOUCHES]->(f:File)
        WITH n, score,
             collect(DISTINCT p.name) AS products,
             collect(DISTINCT t.name + '@' + t.version) AS techs,
             collect(DISTINCT f.path) AS files
        RETURN
          labels(n)[0] AS type,
          n.id AS id,
          n.title AS title,
          CASE WHEN n.reasoning IS NOT NULL THEN n.reasoning ELSE n.detail END AS detail,
          products,
          n.date AS date,
          techs + files AS related
        ORDER BY score DESC
        LIMIT $limit
      `;
      const result = await session.run(cypher, {
        searchQuery,
        product: input.product ?? null,
        limit: input.limit,
      });
      records = result.records;
    } catch (_err) {
      // Fallback: CONTAINS search
      const cypher = `
        MATCH (n)
        WHERE ${labelCond}
          AND (toLower(n.title) CONTAINS toLower($queryRaw)
               OR toLower(coalesce(n.detail, '')) CONTAINS toLower($queryRaw)
               OR toLower(coalesce(n.reasoning, '')) CONTAINS toLower($queryRaw))
          ${productFilter}
        OPTIONAL MATCH (n)-[:AFFECTS|APPLIES_TO]->(p:Product)
        OPTIONAL MATCH (n)-[:USES|GOVERNS]->(t:Technology)
        OPTIONAL MATCH (n)-[:TOUCHES]->(f:File)
        WITH n,
             collect(DISTINCT p.name) AS products,
             collect(DISTINCT t.name + '@' + t.version) AS techs,
             collect(DISTINCT f.path) AS files
        RETURN
          labels(n)[0] AS type,
          n.id AS id,
          n.title AS title,
          CASE WHEN n.reasoning IS NOT NULL THEN n.reasoning ELSE n.detail END AS detail,
          products,
          n.date AS date,
          techs + files AS related
        LIMIT $limit
      `;
      const result = await session.run(cypher, {
        queryRaw: input.query,
        product: input.product ?? null,
        limit: input.limit,
      });
      records = result.records;
    }

    const results: QueryResult[] = records.map((rec) => ({
      type: rec.get('type') as string,
      id: rec.get('id') as string,
      title: rec.get('title') as string,
      detail: rec.get('detail') as string | null,
      products: rec.get('products') as string[],
      date: rec.get('date') as string,
      related: rec.get('related') as string[],
    }));

    return { results };
  } finally {
    await session.close();
  }
}
