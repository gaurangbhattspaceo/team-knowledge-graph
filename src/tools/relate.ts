import { z } from 'zod';
import { getSession } from '../neo4j.js';

export const relateSchema = z.object({
  from: z.string(),
  to: z.string(),
  relationship: z.string(),
  detail: z.string().optional(),
});

export type RelateInput = z.infer<typeof relateSchema>;

export async function relate(input: RelateInput): Promise<{ stored: true }> {
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();

  try {
    await session.run(
      `MERGE (a:Product {name: $from})
       MERGE (b:Product {name: $to})
       CREATE (a)-[:RELATES_TO {relationship: $relationship, detail: $detail, date: $date}]->(b)`,
      {
        from: input.from,
        to: input.to,
        relationship: input.relationship,
        detail: input.detail ?? null,
        date,
      }
    );

    return { stored: true };
  } finally {
    await session.close();
  }
}
