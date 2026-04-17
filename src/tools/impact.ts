import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const impactSchema = z.object({
  change: z.string().describe('Description of the change being made'),
  product: z.string().describe('Product being changed'),
  platform: z.string().optional(),
});

export type ImpactInput = z.infer<typeof impactSchema>;

interface ConnectedProduct {
  name: string;
  relationship: string;
  detail: string | null;
}

interface AtRiskRule {
  id: string;
  title: string;
  severity: string;
  repeat_count: number;
}

interface ImpactResult {
  directly_affected: string;
  connected_products: ConnectedProduct[];
  rules_at_risk: AtRiskRule[];
}

/** Convert neo4j integer or plain number to JS number */
function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val && typeof (val as any).toNumber === 'function') return (val as any).toNumber();
  return 0;
}

export async function impact(input: ImpactInput, _repo: RepoInfo | null): Promise<ImpactResult> {
  const session = getSession();

  try {
    // 1. Find connected products (both directions)
    const connectedResult = await session.run(
      `MATCH (source:Product {name: $product})
       OPTIONAL MATCH (source)-[r1:RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->(target:Product)
       WITH source, collect({name: target.name, relationship: r1.relationship, detail: r1.detail}) AS outgoing
       OPTIONAL MATCH (other:Product)-[r2:RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->(source)
       WITH source, outgoing, collect({name: other.name, relationship: r2.relationship, detail: r2.detail}) AS incoming
       RETURN outgoing, incoming`,
      { product: input.product }
    );

    const connectedProducts: ConnectedProduct[] = [];

    if (connectedResult.records.length > 0) {
      const record = connectedResult.records[0];
      const outgoing: any[] = record.get('outgoing') ?? [];
      const incoming: any[] = record.get('incoming') ?? [];

      for (const item of outgoing) {
        if (item.name != null) {
          connectedProducts.push({
            name: item.name,
            relationship: item.relationship ?? 'RELATES_TO',
            detail: item.detail ?? null,
          });
        }
      }

      for (const item of incoming) {
        if (item.name != null) {
          connectedProducts.push({
            name: item.name,
            relationship: item.relationship ?? 'RELATES_TO',
            detail: item.detail ?? null,
          });
        }
      }
    }

    // 2. Build combined list of product names for rule lookup
    const allProductNames = [input.product, ...connectedProducts.map((p) => p.name)];

    // 3. Find active rules that APPLIES_TO any product in the combined list
    const rulesResult = await session.run(
      `MATCH (n)-[:APPLIES_TO]->(p:Product)
       WHERE p.name IN $products
         AND (n:DesignRule OR n:PlatformRule OR n:Rule)
         AND COALESCE(n.status, 'active') = 'active'
       RETURN DISTINCT
         n.id AS id,
         n.title AS title,
         COALESCE(n.severity, 'should') AS severity,
         COALESCE(n.repeat_count, 1) AS repeat_count`,
      { products: allProductNames }
    );

    const rulesAtRisk: AtRiskRule[] = rulesResult.records.map((record) => ({
      id: record.get('id'),
      title: record.get('title'),
      severity: record.get('severity'),
      repeat_count: toNum(record.get('repeat_count')),
    }));

    return {
      directly_affected: input.product,
      connected_products: connectedProducts,
      rules_at_risk: rulesAtRisk,
    };
  } finally {
    await session.close();
  }
}
