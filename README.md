# Team Knowledge Graph

MCP server backed by Neo4j for storing team decisions, constraints, business rules, and cross-product relationships. Works with any git project. Connects to Claude Code, Cursor, or any MCP-compatible AI agent.

## Quick Start

```bash
# 1. Start Neo4j
docker compose up -d

# 2. Build
npm install && npm run build

# 3. Add to Claude Code (~/.claude/settings.json)
```

```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["/path/to/team-knowledge-graph/dist/index.js"]
    }
  }
}
```

```bash
# 4. Start a Claude Code session — the MCP server auto-connects
```

## Tools

| Tool | What it does |
|---|---|
| `knowledge_query` | Search for decisions, constraints, rules |
| `knowledge_decide` | Record a decision with reasoning |
| `knowledge_constraint` | Record a technical limitation |
| `knowledge_rule` | Record a business rule |
| `knowledge_relate` | Record a product relationship |
| `knowledge_status` | Show graph stats |

## How It Works

- Auto-detects the git repo from your working directory
- Stores knowledge in Neo4j as a graph (nodes + relationships)
- Queries scoped to current repo by default, or search globally
- Full-text search across all entries
- Every entry linked to products, files, and technologies

## Neo4j Browser

Visit http://localhost:7474 to explore the graph visually.

Example queries:
```cypher
-- All decisions affecting the AI agent
MATCH (d:Decision)-[:AFFECTS]->(:Product {name: 'ai-agent'}) RETURN d

-- All breaking constraints
MATCH (c:Constraint {severity: 'breaking'}) RETURN c

-- Product dependency map
MATCH (a:Product)-[r]->(b:Product) RETURN a, r, b
```

## Seed Data

```bash
npm run seed  # loads FieldCamp knowledge from seed/fieldcamp.cypher
```

## Development

```bash
npm install
npm run build
npm test       # requires Neo4j running
```

## Configuration

Environment variables (or defaults):
- `NEO4J_URI` — `bolt://localhost:7687`
- `NEO4J_USER` — `neo4j`
- `NEO4J_PASSWORD` — `knowledge-graph-local`
