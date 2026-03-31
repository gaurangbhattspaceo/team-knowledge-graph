import { z } from 'zod';
import { generateId, parseTechRef } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const constraintSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
  severity: z.enum(['breaking', 'warning', 'info']),
  technologies: z.array(z.string()).optional(),
  products: z.array(z.string()).optional(),
});

export type ConstraintInput = z.infer<typeof constraintSchema>;

export async function constraint(input: ConstraintInput, repo: RepoInfo | null): Promise<{ id: string; stored: true }> {
  const id = generateId();
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();

  try {
    // Create the Constraint node
    await session.run(
      `CREATE (c:Constraint {
        id: $id,
        title: $title,
        detail: $detail,
        severity: $severity,
        date: $date,
        createdBy: $createdBy
      })`,
      {
        id,
        title: input.title,
        detail: input.detail ?? null,
        severity: input.severity,
        date,
        createdBy: 'ai-agent',
      }
    );

    // Link to Repo via DISCOVERED_IN
    if (repo) {
      await session.run(
        `MERGE (r:Repo {url: $url}) SET r.name = $name
         WITH r
         MATCH (c:Constraint {id: $id})
         CREATE (c)-[:DISCOVERED_IN]->(r)`,
        { url: repo.url, name: repo.name, id }
      );
    }

    // Link to Technologies via GOVERNS
    if (input.technologies && input.technologies.length > 0) {
      for (const techRef of input.technologies) {
        const { name, version } = parseTechRef(techRef);
        await session.run(
          `MERGE (t:Technology {name: $name, version: $version})
           WITH t
           MATCH (c:Constraint {id: $id})
           CREATE (c)-[:GOVERNS]->(t)`,
          { name, version, id }
        );
      }
    }

    // Link to Products via APPLIES_TO
    if (input.products && input.products.length > 0) {
      for (const productName of input.products) {
        await session.run(
          `MERGE (p:Product {name: $name})
           WITH p
           MATCH (c:Constraint {id: $id})
           CREATE (c)-[:APPLIES_TO]->(p)`,
          { name: productName, id }
        );
      }
    }

    return { id, stored: true };
  } finally {
    await session.close();
  }
}
