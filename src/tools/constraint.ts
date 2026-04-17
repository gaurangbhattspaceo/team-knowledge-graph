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
  confidence: z.enum(['explicit', 'inferred', 'ambiguous']).optional().default('explicit').describe('explicit = user stated, inferred = AI detected, ambiguous = uncertain'),
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
        createdBy: $createdBy,
        confidence: $confidence
      })`,
      {
        id,
        title: input.title,
        detail: input.detail ?? null,
        severity: input.severity,
        date,
        createdBy: 'ai-agent',
        confidence: input.confidence || 'explicit',
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

    // Auto cross-reference
    try {
      await session.run(
        `MATCH (c:Constraint {id: $id})
         CALL db.index.fulltext.queryNodes('knowledge_search', $searchTerms) YIELD node, score
         WHERE score > 1.0 AND node.id <> $id
         WITH c, node, score
         LIMIT 3
         MERGE (c)-[:RELATED_TO {score: score, auto: true}]->(node)`,
        { id, searchTerms: input.title.split(' ').slice(0, 5).join(' ') + '*' }
      );
    } catch { /* skip if fulltext not ready */ }

    return { id, stored: true };
  } finally {
    await session.close();
  }
}
