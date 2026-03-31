# Team Knowledge Graph

AI coding agents that remember decisions across sessions. Backed by Neo4j.

## Install (3 steps)

### Step 1: Clone and build

```bash
git clone <your-repo-url>/team-knowledge-graph.git
cd team-knowledge-graph
npm install && npm run build
```

### Step 2: Start Neo4j

```bash
docker compose up -d
```

Wait 10 seconds. Verify at http://localhost:7474 (login: `neo4j` / `knowledge-graph-local`).

### Step 3: Configure Claude Code

Run this one-liner (copy-paste):

```bash
# Add MCP server
cat > ~/.claude/.mcp.json << 'EOF'
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["INSTALL_PATH/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "knowledge-graph-local"
      }
    }
  }
}
EOF
sed -i '' "s|INSTALL_PATH|$(pwd)|g" ~/.claude/.mcp.json

# Add auto-load hook to settings.json (if not already present)
# This injects known knowledge at the start of every session
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.claude/settings.json';
const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
if (!s.hooks) s.hooks = {};
if (!s.hooks.SessionStart) {
  s.hooks.SessionStart = [{hooks:[{type:'command',command:'node $(pwd)/bin/session-start.js',timeout:10,statusMessage:'Loading team knowledge...'}]}];
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  console.log('Added SessionStart hook');
} else { console.log('SessionStart hook already exists'); }
"

# Add CLAUDE.md instructions for auto-save during sessions
cat >> ~/.claude/CLAUDE.md << 'INSTRUCTIONS'

# Team Knowledge Graph
You have access to a Team Knowledge Graph via MCP tools (knowledge_*). Use it automatically:
- **Discover something doesn't work** → call knowledge_constraint
- **Make a technical decision** → call knowledge_decide with reasoning
- **Learn a business rule** → call knowledge_rule
- Before architecture decisions, call knowledge_query to check what's already known.
INSTRUCTIONS
```

**Done.** Start a new Claude Code session — you'll see "Loading team knowledge..." and 6 `knowledge_*` tools will be available.

### Team Sharing

For the whole team to share one knowledge graph, point everyone to the same Neo4j:

**Option A: Shared server** — run Neo4j on a team server, everyone sets `NEO4J_URI=bolt://server:7687`

**Option B: Neo4j Aura** (cloud) — free tier at https://neo4j.com/cloud/aura-free/ — update URI/user/password in `.mcp.json`

### Load existing knowledge

```bash
npm run seed   # loads FieldCamp decisions, constraints, rules
```

---

## What It Does

Every Claude Code session:

1. **Start** — auto-loads known constraints, decisions, rules into context
2. **During** — agent saves discoveries in real-time via MCP tools
3. **End** — safety net extracts anything the agent missed

Knowledge grows with every session. New team members get instant access to everything the team has learned.

## Tools

| Tool | When to use |
|---|---|
| `knowledge_query` | Search what's known ("billing rules", "sonnet limitations") |
| `knowledge_decide` | Record a decision with reasoning |
| `knowledge_constraint` | Record something that doesn't work |
| `knowledge_rule` | Record a business rule or operational fact |
| `knowledge_relate` | Record how products connect |
| `knowledge_status` | See graph stats |

## Neo4j Browser

http://localhost:7474 — explore the graph visually.

```cypher
// All breaking constraints
MATCH (c:Constraint {severity: 'breaking'}) RETURN c

// Decisions affecting a product
MATCH (d:Decision)-[:AFFECTS]->(:Product {name: 'ai-agent'}) RETURN d

// Product dependency map
MATCH (a:Product)-[r]->(b:Product) RETURN a, r, b

// Everything about billing
CALL db.index.fulltext.queryNodes('knowledge_search', 'billing') YIELD node RETURN node
```

## Configuration

| Env var | Default |
|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` |
| `NEO4J_USER` | `neo4j` |
| `NEO4J_PASSWORD` | `knowledge-graph-local` |

## Development

```bash
npm install
npm run build
npm test          # requires Neo4j running
npm run dev       # watch mode
```
