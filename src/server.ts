import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RepoInfo } from './git.js';
import { decideSchema, decide } from './tools/decide.js';
import { constraintSchema, constraint } from './tools/constraint.js';
import { ruleSchema, rule } from './tools/rule.js';
import { querySchema, query } from './tools/query.js';
import { relateSchema, relate } from './tools/relate.js';
import { statusSchema, status } from './tools/status.js';
import { lintSchema, lint } from './tools/lint.js';
import { ingestSchema, ingest } from './tools/ingest.js';
import { guardSchema, guard } from './tools/guard.js';
import { reviewSchema, review } from './tools/review.js';

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

  server.tool('knowledge_lint', 'Health check the knowledge graph. Finds stale entries, orphan nodes, contradictions, ambiguous entries, and duplicates. Use fix=true to auto-mark stale entries.', lintSchema.shape, async (args) => {
    const result = await lint(lintSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('knowledge_ingest', 'Capture feedback from founder/CSM/client. Auto-decomposes into design rules, platform rules, or business rules. Detects repeated feedback and auto-escalates severity.', ingestSchema.shape, async (args) => {
    const result = await ingest(ingestSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('knowledge_guard', 'Pre-flight check before building. Returns all design rules, platform rules, and business rules that apply to the work you are about to do. Call this before writing code.', guardSchema.shape, async (args) => {
    const result = await guard(guardSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('knowledge_review', 'Review a diff or PR against the knowledge graph. Returns all rules that apply to the changes, highlighting CI gates and must-follow rules.', reviewSchema.shape, async (args) => {
    const result = await review(reviewSchema.parse(args), repo);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}
