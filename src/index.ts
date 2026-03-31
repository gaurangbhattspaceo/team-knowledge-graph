import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { detectRepo } from './git.js';
import { verifyConnection, initSchema, closeDriver } from './neo4j.js';

async function main() {
  const repo = detectRepo(process.cwd());
  const server = createServer(repo);

  const connected = await verifyConnection();
  if (connected) {
    await initSchema();
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await closeDriver();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Knowledge] Fatal:', err);
  process.exit(1);
});
