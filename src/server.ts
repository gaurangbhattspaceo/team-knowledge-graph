import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RepoInfo } from './git.js';
import { decideSchema, decide } from './tools/decide.js';
import { constraintSchema, constraint } from './tools/constraint.js';
import { ruleSchema, rule } from './tools/rule.js';
import { querySchema, query } from './tools/query.js';
import { relateSchema, relate } from './tools/relate.js';
import { statusSchema, status } from './tools/status.js';

export function createServer(repo: RepoInfo | null): McpServer {
  const server = new McpServer({
    name: 'team-knowledge-graph',
    version: '0.1.0',
  });

  console.error(`[Knowledge] ${repo ? `Repo: ${repo.name} (${repo.url})` : 'No git repo detected'}`);

  server.tool('knowledge_decide', 'Record an architectural or technical decision with reasoning. Links to products, files, and technologies.', decideSchema.shape, async (args) => {
    const result = await decide(decideSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('knowledge_constraint', 'Record a discovered technical constraint or limitation.', constraintSchema.shape, async (args) => {
    const result = await constraint(constraintSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('knowledge_rule', 'Record a business rule or operational fact.', ruleSchema.shape, async (args) => {
    const result = await rule(ruleSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('knowledge_query', 'Search the knowledge graph for decisions, constraints, and rules.', querySchema.shape, async (args) => {
    const result = await query(querySchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('knowledge_relate', 'Record a relationship between products.', relateSchema.shape, async (args) => {
    const result = await relate(relateSchema.parse(args));
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.tool('knowledge_status', 'Show knowledge graph stats — counts and recent entries.', statusSchema.shape, async (args) => {
    const result = await status(statusSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}
