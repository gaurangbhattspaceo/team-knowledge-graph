# Team Knowledge Graph

AI coding agents that remember decisions across sessions. Backed by Neo4j.

## Install

```bash
npm install -g team-knowledge-graph
tkg-setup
```

That's it. The setup:
- Starts Neo4j (Docker)
- Configures MCP server
- Adds auto-load hook (loads knowledge at session start)
- Adds auto-save instructions (saves discoveries during work)

Start a new AI coding session — it works.

## What Happens Automatically

```
Session starts → "Loading team knowledge..."
    → Injects known constraints, decisions, rules

You work → agent discovers things
    → Saves to graph in real-time (no manual action)

Next session → starts with everything the team knows
```

## Install (without npm publish)

If you haven't published to npm yet:

```bash
git clone <repo-url>/team-knowledge-graph.git
cd team-knowledge-graph
npm install && npm run build
node bin/setup.js
```

## Team Sharing

Everyone on the team runs `tkg-setup`. To share one graph:

**Local team:** Point everyone to one Neo4j instance:
```bash
NEO4J_URI=bolt://your-server:7687 tkg-setup
```

**Cloud:** Use Neo4j Aura (free tier at https://neo4j.com/cloud/aura-free/)

## Tools

| Tool | When it's used |
|---|---|
| `knowledge_query` | Search what the team knows |
| `knowledge_decide` | Record a decision with reasoning |
| `knowledge_constraint` | Record something that doesn't work |
| `knowledge_rule` | Record a business rule |
| `knowledge_relate` | Record how products connect |
| `knowledge_status` | See graph stats |

## Neo4j Browser

http://localhost:7474 (login: `neo4j` / `knowledge-graph-local`)

```cypher
// Everything the team knows
MATCH (n) WHERE n:Decision OR n:Constraint OR n:Rule RETURN n

// Product dependency map
MATCH (a:Product)-[r]->(b:Product) RETURN a, r, b
```

## Uninstall

```bash
npm uninstall -g team-knowledge-graph
docker stop team-knowledge-neo4j && docker rm team-knowledge-neo4j
```

Remove from `~/.claude/.mcp.json` and `~/.claude/settings.json` hooks.
