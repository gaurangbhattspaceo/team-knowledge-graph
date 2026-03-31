import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RepoInfo } from './git.js';

export function createServer(repo: RepoInfo | null): McpServer {
  const server = new McpServer({
    name: 'team-knowledge-graph',
    version: '0.1.0',
  });

  const repoContext = repo
    ? `Connected to repo: ${repo.name} (${repo.url})`
    : 'No git repo detected — knowledge will not be scoped to a repo';

  console.error(`[Knowledge] ${repoContext}`);

  // Tools registered in subsequent tasks
  return server;
}
