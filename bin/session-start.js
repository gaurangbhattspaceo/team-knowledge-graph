#!/usr/bin/env node
/**
 * SessionStart hook — queries the knowledge graph for entries relevant to this repo
 * and outputs them as context for the AI agent.
 *
 * Priority ordering:
 * 1. REPEATED FEEDBACK (repeat_count >= 2) — founder said this 2+ times
 * 2. MUST design/platform rules
 * 3. Active constraints
 * 4. Recent decisions
 * 5. Business rules
 *
 * Output goes to stdout → injected into conversation context.
 */
const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'knowledge-graph-local';

function toNum(v) {
  if (v && typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
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
    detectRepo(process.cwd()); // reserved for future repo-scoped filtering

    let output = '';

    // 1. REPEATED FEEDBACK — rules with repeat_count >= 2
    const repeatedResult = await session.run(`
      MATCH (n)
      WHERE (n:DesignRule OR n:PlatformRule OR n:Rule)
      AND COALESCE(n.status, 'active') = 'active'
      AND COALESCE(n.repeat_count, 1) >= 2
      RETURN n.title AS title,
             COALESCE(n.repeat_count, 1) AS repeat_count,
             n.last_violated AS last_violated,
             COALESCE(n.source_name, '') AS source,
             [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule','Rule']][0] AS type
      ORDER BY n.repeat_count DESC
      LIMIT 10
    `);

    if (repeatedResult.records.length > 0) {
      output += `## REPEATED FEEDBACK (said 2+ times — do not miss these)\n`;
      for (const rec of repeatedResult.records) {
        const title = rec.get('title');
        const count = toNum(rec.get('repeat_count'));
        const source = rec.get('source') || 'unknown';
        const lastViolated = rec.get('last_violated');
        output += `- ${title} [${count}x, source: ${source}${lastViolated ? ', last violated: ' + lastViolated : ''}]\n`;
      }
      output += '\n';
    }

    // 2. DESIGN + PLATFORM RULES — must severity, not yet repeated
    const designResult = await session.run(`
      MATCH (n)
      WHERE (n:DesignRule OR n:PlatformRule)
      AND COALESCE(n.status, 'active') = 'active'
      AND COALESCE(n.severity, 'should') = 'must'
      AND COALESCE(n.repeat_count, 1) < 2
      OPTIONAL MATCH (n)-[:APPLIES_TO]->(p:Product)
      WITH n, collect(DISTINCT p.name) AS products,
           [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule']][0] AS type
      RETURN type, n.title AS title, products,
             COALESCE(n.scope, 'product') AS scope,
             COALESCE(n.platforms, []) AS platforms
      ORDER BY n.date DESC
      LIMIT 15
    `);

    if (designResult.records.length > 0) {
      output += `## Design Rules (must-follow)\n`;
      for (const rec of designResult.records) {
        const title = rec.get('title');
        const products = rec.get('products').filter(Boolean);
        const platforms = rec.get('platforms');
        const tags = [];
        if (products.length > 0) tags.push(products.join(', '));
        if (platforms.length > 0 && !platforms.includes('all')) tags.push(platforms.join(', '));
        const tagStr = tags.length > 0 ? ` [${tags.join(' | ')}]` : '';
        output += `- ${title}${tagStr}\n`;
      }
      output += '\n';
    }

    // 3. CONSTRAINTS
    const constraintResult = await session.run(`
      MATCH (n:Constraint)
      WHERE n.status IS NULL OR n.status <> 'superseded'
      OPTIONAL MATCH (n)-[:AFFECTS|GOVERNS|APPLIES_TO]->(p:Product)
      WITH n, collect(DISTINCT p.name) AS products
      RETURN n.title AS title, n.severity AS severity, products
      ORDER BY n.date DESC
      LIMIT 10
    `);

    if (constraintResult.records.length > 0) {
      output += `## Known Constraints\n`;
      for (const rec of constraintResult.records) {
        const title = rec.get('title');
        const severity = rec.get('severity');
        const products = rec.get('products').filter(Boolean);
        const sev = severity === 'breaking' ? '🔴' : severity === 'warning' ? '🟡' : 'ℹ️';
        const productTag = products.length > 0 ? ` [${products.join(', ')}]` : '';
        output += `${sev} ${title}${productTag}\n`;
      }
      output += '\n';
    }

    // 4. DECISIONS
    const decisionResult = await session.run(`
      MATCH (n:Decision)
      WHERE n.status IS NULL OR n.status <> 'superseded'
      OPTIONAL MATCH (n)-[:AFFECTS]->(p:Product)
      WITH n, collect(DISTINCT p.name) AS products
      RETURN n.title AS title, COALESCE(n.reasoning, '') AS reasoning, products
      ORDER BY n.date DESC
      LIMIT 10
    `);

    if (decisionResult.records.length > 0) {
      output += `## Active Decisions\n`;
      for (const rec of decisionResult.records) {
        const title = rec.get('title');
        const reasoning = rec.get('reasoning');
        const products = rec.get('products').filter(Boolean);
        const productTag = products.length > 0 ? ` [${products.join(', ')}]` : '';
        output += `- ${title}${productTag}${reasoning ? ' — ' + reasoning.substring(0, 100) : ''}\n`;
      }
      output += '\n';
    }

    // 5. BUSINESS RULES
    const ruleResult = await session.run(`
      MATCH (n:Rule)
      WHERE n.status IS NULL OR n.status <> 'superseded'
      OPTIONAL MATCH (n)-[:APPLIES_TO]->(p:Product)
      WITH n, collect(DISTINCT p.name) AS products
      RETURN n.title AS title, n.domain AS domain, products
      ORDER BY n.date DESC
      LIMIT 10
    `);

    if (ruleResult.records.length > 0) {
      output += `## Business Rules\n`;
      for (const rec of ruleResult.records) {
        const title = rec.get('title');
        const domain = rec.get('domain');
        const products = rec.get('products').filter(Boolean);
        const productTag = products.length > 0 ? ` [${products.join(', ')}]` : '';
        output += `- ${domain ? '[' + domain + '] ' : ''}${title}${productTag}\n`;
      }
      output += '\n';
    }

    if (output) {
      output += `_Use knowledge_query to search. Use knowledge_guard before building. Use knowledge_ingest to capture feedback._\n`;
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
