#!/usr/bin/env node
/**
 * SessionStart hook — queries the knowledge graph for entries relevant to this repo
 * and outputs them as context for the AI agent.
 *
 * Runs automatically at the start of every Claude Code session.
 * Output goes to stdout → injected into conversation context.
 */
const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'knowledge-graph-local';

// Detect git repo from cwd
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
        return url;
      }
      return `local/${path.basename(dir)}`;
    }
    dir = path.dirname(dir);
  }
  return null;
}

async function main() {
  let driver;
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    const session = driver.session();

    const repoUrl = detectRepo(process.cwd());

    // Get recent entries (global — cross-project knowledge is the point)
    const result = await session.run(`
      MATCH (n)
      WHERE ANY(label IN labels(n) WHERE label IN ['Decision', 'Constraint', 'Rule'])
      AND n.status IS NULL OR n.status <> 'superseded'
      OPTIONAL MATCH (n)-[:AFFECTS|GOVERNS|APPLIES_TO]->(p:Product)
      WITH n, COLLECT(DISTINCT p.name) AS products,
           [l IN labels(n) WHERE l IN ['Decision','Constraint','Rule']][0] AS type
      RETURN type, n.title AS title,
             COALESCE(n.detail, n.reasoning, '') AS detail,
             n.severity AS severity,
             n.domain AS domain,
             products
      ORDER BY n.date DESC
      LIMIT 30
    `);

    if (result.records.length === 0) {
      await session.close();
      return; // Empty graph — nothing to inject
    }

    const constraints = [];
    const decisions = [];
    const rules = [];

    for (const record of result.records) {
      const type = record.get('type');
      const title = record.get('title');
      const detail = record.get('detail');
      const severity = record.get('severity');
      const products = record.get('products').filter(Boolean);
      const productTag = products.length > 0 ? ` [${products.join(', ')}]` : '';

      if (type === 'Constraint') {
        const sev = severity === 'breaking' ? '🔴' : severity === 'warning' ? '🟡' : 'ℹ️';
        constraints.push(`${sev} ${title}${productTag}`);
      } else if (type === 'Decision') {
        decisions.push(`• ${title}${productTag}${detail ? ' — ' + detail.substring(0, 100) : ''}`);
      } else if (type === 'Rule') {
        const domain = record.get('domain');
        rules.push(`• [${domain}] ${title}${productTag}`);
      }
    }

    let output = '';

    if (constraints.length > 0) {
      output += `## Known Constraints (from Team Knowledge Graph)\n`;
      output += constraints.join('\n') + '\n\n';
    }

    if (decisions.length > 0) {
      output += `## Active Decisions\n`;
      output += decisions.join('\n') + '\n\n';
    }

    if (rules.length > 0) {
      output += `## Business Rules\n`;
      output += rules.join('\n') + '\n\n';
    }

    if (output) {
      output += `_Use knowledge_query to search for more. Use knowledge_decide/knowledge_constraint/knowledge_rule to record new discoveries._\n`;
      console.log(output);
    }

    await session.close();
  } catch (err) {
    // Silent fail — don't block session start if Neo4j is down
  } finally {
    if (driver) await driver.close();
  }
}

main();
