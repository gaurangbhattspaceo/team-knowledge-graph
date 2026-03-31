import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const ruleSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
  domain: z.string(),
  products: z.array(z.string()).optional(),
});

export type RuleInput = z.infer<typeof ruleSchema>;

export async function rule(input: RuleInput, repo: RepoInfo | null): Promise<{ id: string; stored: true }> {
  const id = generateId();
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();

  try {
    // Create the Rule node
    await session.run(
      `CREATE (r:Rule {
        id: $id,
        title: $title,
        detail: $detail,
        domain: $domain,
        date: $date,
        createdBy: $createdBy
      })`,
      {
        id,
        title: input.title,
        detail: input.detail ?? null,
        domain: input.domain,
        date,
        createdBy: 'ai-agent',
      }
    );

    // Link to Repo via DISCOVERED_IN
    if (repo) {
      await session.run(
        `MERGE (repo:Repo {url: $url}) SET repo.name = $name
         WITH repo
         MATCH (r:Rule {id: $id})
         CREATE (r)-[:DISCOVERED_IN]->(repo)`,
        { url: repo.url, name: repo.name, id }
      );
    }

    // Link to Products via APPLIES_TO
    if (input.products && input.products.length > 0) {
      for (const productName of input.products) {
        await session.run(
          `MERGE (p:Product {name: $name})
           WITH p
           MATCH (r:Rule {id: $id})
           CREATE (r)-[:APPLIES_TO]->(p)`,
          { name: productName, id }
        );
      }
    }

    return { id, stored: true };
  } finally {
    await session.close();
  }
}
