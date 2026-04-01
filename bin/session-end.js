#!/usr/bin/env node
/**
 * SessionEnd hook — extracts decisions, constraints, and rules from
 * the conversation and saves them to the knowledge graph.
 *
 * Receives the session transcript via $ARGUMENTS (JSON from MCP client hooks).
 * Parses it for patterns that indicate decisions, constraints, or rules.
 * Saves to Neo4j directly (no MCP — this runs after the session).
 */
const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'knowledge-graph-local';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function detectRepo(cwd) {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const gitConfig = path.join(dir, '.git', 'config');
    if (fs.existsSync(gitConfig)) {
      const content = fs.readFileSync(gitConfig, 'utf-8');
      const match = content.match(/\[remote "origin"\]\s*\n\s*url = (.+)/);
      if (match) {
        let url = match[1].trim();
        url = url.replace(/^https?:\/\//, '').replace(/^git@/, '');
        url = url.replace(/^([^/:]+):(?!\d+\/)/, '$1/');
        url = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
        const name = url.split('/').pop() || url;
        return { url, name };
      }
      return { url: `local/${path.basename(dir)}`, name: path.basename(dir) };
    }
    dir = path.dirname(dir);
  }
  return null;
}

async function main() {
  // Read hook input from stdin (MCP client passes session data)
  let input = '';
  try {
    input = fs.readFileSync('/dev/stdin', 'utf-8');
  } catch {
    // No stdin — might be called without pipe
  }

  if (!input || input.length < 100) return; // Too short to contain anything useful

  let driver;
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    const session = driver.session();
    const repo = detectRepo(process.cwd());
    const today = new Date().toISOString().split('T')[0];

    let saved = 0;

    // Pattern 1: Look for tool calls to knowledge_* that the AI already made
    // If the AI used the MCP tools during the session, data is already saved — skip
    if (input.includes('knowledge_decide') || input.includes('knowledge_constraint') || input.includes('knowledge_rule')) {
      // AI already saved during session — check for any it missed
    }

    // Pattern 2: Detect "doesn't work" / "not supported" / error discoveries
    const constraintPatterns = [
      /(?:doesn't|does not|cannot|can't) support\s+(.+?)[\.\n]/gi,
      /(?:not supported|not available|not compatible)(?:\s+(?:on|with|for|in)\s+)?(.+?)[\.\n]/gi,
      /(?:error|failed|breaking):\s*(.+?)[\.\n]/gi,
    ];

    const foundConstraints = new Set();
    for (const pattern of constraintPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const title = match[1]?.trim();
        if (title && title.length > 10 && title.length < 200) {
          foundConstraints.add(title);
        }
      }
    }

    // Only save constraints that aren't already in the graph
    for (const title of foundConstraints) {
      const existing = await session.run(
        'MATCH (c:Constraint) WHERE toLower(c.title) CONTAINS toLower($search) RETURN c LIMIT 1',
        { search: title.substring(0, 50) }
      );
      if (existing.records.length === 0) {
        const id = generateId();
        await session.run(
          `CREATE (c:Constraint {id: $id, title: $title, detail: '', severity: 'info', date: $date, createdBy: 'auto-extract'})`,
          { id, title: title.substring(0, 200), date: today }
        );
        if (repo) {
          await session.run(
            `MERGE (r:Repo {url: $url}) ON CREATE SET r.name = $name
             WITH r MATCH (c:Constraint {id: $id}) MERGE (c)-[:DISCOVERED_IN]->(r)`,
            { url: repo.url, name: repo.name, id }
          );
        }
        saved++;
      }
    }

    if (saved > 0) {
      console.error(`[Knowledge] Auto-extracted ${saved} new constraint(s) from session`);
    }

    await session.close();
  } catch (err) {
    // Silent fail — don't break anything on session end
  } finally {
    if (driver) await driver.close();
  }
}

main();
