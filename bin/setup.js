#!/usr/bin/env node
/**
 * Team Knowledge Graph — One-command setup.
 *
 * Usage:
 *   npx team-knowledge-graph setup
 *   # or after global install:
 *   tkg-setup
 *
 * What it does:
 *   1. Checks Docker is running
 *   2. Starts Neo4j container (if not already running)
 *   3. Waits for Neo4j to be ready
 *   4. Configures Claude Code MCP server (~/.claude/.mcp.json)
 *   5. Adds SessionStart hook to Claude Code settings
 *   6. Adds CLAUDE.md instructions for auto-save
 *   7. Verifies everything works
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const MCP_JSON = path.join(CLAUDE_DIR, '.mcp.json');
const SETTINGS_JSON = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
const PKG_DIR = path.dirname(__dirname); // where the npm package is installed

const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'knowledge-graph-local';

// ── Helpers ──

function log(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ⚠ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exit(1); }
function step(msg) { console.log(`\n▸ ${msg}`); }

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJSON(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
}

// ── Step 1: Check Docker ──

function checkDocker() {
  step('Checking Docker...');
  const result = run('docker info');
  if (!result) fail('Docker is not running. Please start Docker Desktop and try again.');
  log('Docker is running');
}

// ── Step 2: Start Neo4j ──

function startNeo4j() {
  step('Starting Neo4j...');

  // Check if already running
  const running = run('docker ps --filter name=team-knowledge-neo4j --format "{{.Names}}"');
  if (running && running.includes('team-knowledge-neo4j')) {
    log('Neo4j already running');
    return;
  }

  // Check if container exists but stopped
  const exists = run('docker ps -a --filter name=team-knowledge-neo4j --format "{{.Names}}"');
  if (exists && exists.includes('team-knowledge-neo4j')) {
    run('docker start team-knowledge-neo4j');
    log('Neo4j container restarted');
  } else {
    // Create new container
    run(`docker run -d \
      --name team-knowledge-neo4j \
      -p 7474:7474 -p 7687:7687 \
      -v team-knowledge-neo4j-data:/data \
      -e NEO4J_AUTH=${NEO4J_USER}/${NEO4J_PASSWORD} \
      -e "NEO4J_PLUGINS=[]" \
      --restart unless-stopped \
      neo4j:5-community`);
    log('Neo4j container created');
  }
}

function waitForNeo4j() {
  step('Waiting for Neo4j to be ready...');
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const result = run('curl -sf http://localhost:7474 > /dev/null 2>&1 && echo ok');
    if (result === 'ok') {
      log('Neo4j is ready');
      return;
    }
    if (i % 5 === 0 && i > 0) process.stdout.write(`  (waiting... ${i}s)\n`);
    execSync('sleep 1');
  }
  fail('Neo4j failed to start after 30 seconds. Check: docker logs team-knowledge-neo4j');
}

// ── Step 3: Configure Claude Code MCP ──

function configureMCP() {
  step('Configuring Claude Code MCP server...');

  const mcpConfig = readJSON(MCP_JSON);
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

  // Find the entry point
  const entryPoint = path.join(PKG_DIR, 'dist', 'index.js');
  if (!fs.existsSync(entryPoint)) {
    fail(`Entry point not found: ${entryPoint}. Run npm run build first.`);
  }

  mcpConfig.mcpServers.knowledge = {
    command: 'node',
    args: [entryPoint],
    env: {
      NEO4J_URI,
      NEO4J_USER,
      NEO4J_PASSWORD,
    },
  };

  writeJSON(MCP_JSON, mcpConfig);
  log(`MCP server configured in ${MCP_JSON}`);
}

// ── Step 4: Add SessionStart hook ──

function configureHooks() {
  step('Adding auto-load hook...');

  const settings = readJSON(SETTINGS_JSON);
  if (!settings.hooks) settings.hooks = {};

  const hookCommand = `node ${path.join(PKG_DIR, 'bin', 'session-start.js')}`;

  // Check if SessionStart hook already exists with our command
  const existing = settings.hooks.SessionStart || [];
  const alreadyConfigured = existing.some(entry =>
    entry.hooks?.some((h) => h.command?.includes('session-start.js'))
  );

  if (alreadyConfigured) {
    log('SessionStart hook already configured');
  } else {
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart.push({
      hooks: [{
        type: 'command',
        command: hookCommand,
        timeout: 10,
        statusMessage: 'Loading team knowledge...',
      }],
    });
    writeJSON(SETTINGS_JSON, settings);
    log('SessionStart hook added — knowledge auto-loads at session start');
  }
}

// ── Step 5: Add CLAUDE.md instructions ──

function configureClaudeMd() {
  step('Adding auto-save instructions...');

  const marker = '# Team Knowledge Graph';
  let content = '';
  try { content = fs.readFileSync(CLAUDE_MD, 'utf-8'); } catch {}

  if (content.includes(marker)) {
    log('CLAUDE.md instructions already present');
    return;
  }

  const instructions = `
${marker}
You have access to a Team Knowledge Graph via MCP tools (knowledge_*). Use it automatically:
- **Discover something doesn't work** → call knowledge_constraint (breaking/warning/info)
- **Make a technical decision** → call knowledge_decide with reasoning
- **Learn a business rule** → call knowledge_rule with domain
- **Find a cross-product relationship** → call knowledge_relate
- Before architecture decisions, call knowledge_query to check what's already known.
Do NOT save routine code changes or temporary state.
`;

  fs.appendFileSync(CLAUDE_MD, instructions);
  log('CLAUDE.md instructions added — agent auto-saves during sessions');
}

// ── Step 6: Verify ──

function verify() {
  step('Verifying...');
  try {
    const neo4j = require('neo4j-driver');
    const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    const session = driver.session();
    session.run('RETURN 1').then(() => {
      log('Neo4j connection works');
      session.close();
      driver.close();
      printSuccess();
    }).catch(() => {
      warn('Neo4j connection failed — it may still be starting up. Try again in 10 seconds.');
      driver.close();
      printSuccess();
    });
  } catch {
    warn('Could not verify Neo4j — neo4j-driver not found in this context');
    printSuccess();
  }
}

function printSuccess() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Team Knowledge Graph — Setup Complete             ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Neo4j Browser:  http://localhost:7474                    ║
║  Login:          neo4j / knowledge-graph-local            ║
║                                                           ║
║  Start a new Claude Code session — it will:               ║
║    • Auto-load known decisions and constraints            ║
║    • Auto-save new discoveries during work                ║
║                                                           ║
║  6 tools available: knowledge_query, knowledge_decide,    ║
║  knowledge_constraint, knowledge_rule, knowledge_relate,  ║
║  knowledge_status                                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
}

// ── Main ──

console.log('\n🧠 Team Knowledge Graph — Setup\n');

checkDocker();
startNeo4j();
waitForNeo4j();
configureMCP();
configureHooks();
configureClaudeMd();
verify();
