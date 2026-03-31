import { z } from 'zod';
import { generateId, parseTechRef } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const decideSchema = z.object({
  title: z.string(),
  reasoning: z.string(),
  products: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
});

export type DecideInput = z.infer<typeof decideSchema>;

export async function decide(input: DecideInput, repo: RepoInfo | null): Promise<{ id: string; stored: true }> {
  const id = generateId();
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();

  try {
    // Create the Decision node
    await session.run(
      `CREATE (d:Decision {
        id: $id,
        title: $title,
        reasoning: $reasoning,
        date: $date,
        createdBy: $createdBy,
        status: 'active'
      })`,
      { id, title: input.title, reasoning: input.reasoning, date, createdBy: 'ai-agent' }
    );

    // Link to Repo via DISCOVERED_IN
    if (repo) {
      await session.run(
        `MERGE (r:Repo {url: $url}) SET r.name = $name
         WITH r
         MATCH (d:Decision {id: $id})
         CREATE (d)-[:DISCOVERED_IN]->(r)`,
        { url: repo.url, name: repo.name, id }
      );
    }

    // Link to Products via AFFECTS
    if (input.products && input.products.length > 0) {
      for (const productName of input.products) {
        await session.run(
          `MERGE (p:Product {name: $name})
           WITH p
           MATCH (d:Decision {id: $id})
           CREATE (d)-[:AFFECTS]->(p)`,
          { name: productName, id }
        );
      }
    }

    // Link to Files via TOUCHES + BELONGS_TO repo
    if (input.files && input.files.length > 0) {
      for (const filePath of input.files) {
        await session.run(
          `MERGE (f:File {path: $path})
           WITH f
           MATCH (d:Decision {id: $id})
           CREATE (d)-[:TOUCHES]->(f)`,
          { path: filePath, id }
        );
        if (repo) {
          await session.run(
            `MATCH (f:File {path: $path})
             MERGE (r:Repo {url: $url})
             MERGE (f)-[:BELONGS_TO]->(r)`,
            { path: filePath, url: repo.url }
          );
        }
      }
    }

    // Link to Technologies via USES
    if (input.technologies && input.technologies.length > 0) {
      for (const techRef of input.technologies) {
        const { name, version } = parseTechRef(techRef);
        await session.run(
          `MERGE (t:Technology {name: $name, version: $version})
           WITH t
           MATCH (d:Decision {id: $id})
           CREATE (d)-[:USES]->(t)`,
          { name, version, id }
        );
      }
    }

    // Handle supersedes
    if (input.supersedes) {
      await session.run(
        `MATCH (old:Decision {id: $oldId})
         SET old.status = 'superseded'
         WITH old
         MATCH (d:Decision {id: $id})
         CREATE (d)-[:SUPERSEDES]->(old)`,
        { oldId: input.supersedes, id }
      );
    }

    return { id, stored: true };
  } finally {
    await session.close();
  }
}
