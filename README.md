# Team Knowledge Graph

**Your AI coding agents forget everything between sessions. This fixes that.**

Every time you start a new AI coding session, the agent has zero context about past decisions, discovered limitations, or how your products connect. You waste 30-60 minutes per session re-explaining what a previous session already learned.

Team Knowledge Graph is an MCP server backed by Neo4j that gives every AI session instant access to your team's accumulated knowledge — decisions, constraints, business rules, and cross-product relationships.

## The Problem

Without shared knowledge:

```
Monday:    AI discovers "Sonnet doesn't support tool_search" after 20 min of debugging
Tuesday:   Different session hits the same issue. Another 20 min wasted.
Wednesday: New team member's AI session makes the same mistake again.
```

With Team Knowledge Graph:

```
Monday:    AI discovers the limitation → auto-saves to graph
Tuesday:   New session starts → "⚠️ Sonnet doesn't support tool_search" loaded automatically
Wednesday: New team member's session → same knowledge, zero ramp-up time
```

## What It Stores

| Type | Example | When to save |
|---|---|---|
| **Decisions** | "Use Sonnet for simple queries, Opus for plan changes — 5x cheaper" | When you choose one approach over another |
| **Constraints** | "AI SDK v6 uses `inputSchema` not `parameters`" | When you discover something doesn't work |
| **Business Rules** | "Chat billing: Sonnet = 1 credit, Opus = 8 credits" | When you learn how the business operates |
| **Relationships** | "AI Agent calls Solver via Bridge webhook" | When you map how products connect |

Everything is stored as a graph in Neo4j — nodes connected by relationships. Query by keyword, filter by product, explore visually.

## Install

**Prerequisites:** Docker Desktop running, Node.js 20+

```bash
npm install -g team-knowledge-graph
tkg-setup
```

The setup wizard:
1. Starts a Neo4j container (Docker)
2. Configures your MCP client to connect automatically
3. Adds a session-start hook that loads knowledge at the beginning of every session
4. Adds instructions so the AI agent saves discoveries in real-time

**Start a new AI coding session — it works immediately.**

## How It Works

### Automatic — No Manual Action Needed

```
┌─────────────────────────────────────────────────────┐
│  Session Starts                                      │
│                                                      │
│  Hook runs → queries Neo4j → injects into context:  │
│    🔴 "AI SDK v6: use inputSchema not parameters"   │
│    • "Sonnet for 90% queries, Opus for plan changes"│
│    • [billing] "Credits: Sonnet=1, Opus=8"          │
│                                                      │
│  Agent works on your code...                         │
│                                                      │
│  Discovers: "Next.js 16 requires React 19"          │
│  → Immediately calls knowledge_constraint            │
│  → Saved to graph                                    │
│                                                      │
│  Decides: "Use server actions instead of API routes" │
│  → Immediately calls knowledge_decide                │
│  → Saved with reasoning                              │
│                                                      │
│  Session Ends                                        │
│  → Safety net extracts anything the agent missed     │
└─────────────────────────────────────────────────────┘

Next session (same project or different project):
  → Starts with everything the team knows
```

### The 6 Tools

Your AI agent gets these tools automatically:

#### `knowledge_query` — Search what the team knows

```
"What do we know about billing?"
→ Finds: decision about credit pricing, rule about plan limits, 
  constraint about overage not being implemented
```

#### `knowledge_decide` — Record a decision with reasoning

```
Title: "Use Sonnet for simple queries, Opus for plan changes"
Reasoning: "Sonnet is 5x cheaper. Handles lookups, creates, settings. 
            Opus needed only for multi-step schedule changes."
Products: ["ai-agent"]
```

This creates a Decision node linked to the "ai-agent" Product node. When anyone queries "what decisions affect the AI agent?", this shows up.

#### `knowledge_constraint` — Record something that doesn't work

```
Title: "Sonnet does not support tool_search_bm25 or adaptive thinking"
Severity: "breaking"
Technologies: ["ai@6.0.141", "anthropic-sdk@3.0.64"]
Products: ["ai-agent"]
```

Breaking constraints show with 🔴 at the start of every session. No one hits the same wall twice.

#### `knowledge_rule` — Record a business rule

```
Title: "Plan credits: Free=100, Starter=500, Pro=3000, Enterprise=10000"
Domain: "billing"
Products: ["platform"]
```

Business rules are tagged by domain (billing, scheduling, auth, infra) so you can filter.

#### `knowledge_relate` — Record how products connect

```
From: "platform"
To: "ai-agent"  
Relationship: "POST /chat/stream SSE"
```

Builds a product dependency map. Query: "What connects to the solver?" → see all integrations.

#### `knowledge_status` — See what's in the graph

```
→ Repo: my-project
  Decisions: 12
  Constraints: 8  
  Rules: 15
  Products: 4
  Relationships: 6
  Recent: [last 5 entries]
```

## Use Cases

### 1. Solo Developer — Stop Repeating Yourself

**Before:** Every new session, you re-explain your architecture, tech choices, and gotchas.

**After:** Session starts with full context. The AI already knows your stack, your decisions, and what doesn't work.

```
Session 1: You're building an API with Express + Prisma + PostgreSQL
  → AI decides on repository pattern → saves to graph
  → Discovers Prisma doesn't support certain GROUP BY → saves constraint

Session 2: You're adding a new feature
  → AI starts knowing: repository pattern, Prisma limitation
  → Doesn't suggest the pattern that failed last time
```

### 2. Team of Developers — Shared Brain

**Before:** Developer A discovers a limitation on Monday. Developer B hits the same issue on Wednesday. Developer C makes the same mistake next month.

**After:** One Neo4j instance, whole team connected. Discovery by anyone benefits everyone.

```
Dev A (backend):  Discovers rate limit on external API → constraint saved
Dev B (frontend): Starts session → sees the rate limit constraint
                  Implements client-side caching instead of hammering the API
Dev C (new hire): Day 1 → starts session → has the team's entire knowledge base
```

### 3. Multi-Product Company — Cross-Product Awareness

**Before:** The team working on Product A doesn't know what the team working on Product B decided. Inconsistent patterns, duplicated effort, integration surprises.

**After:** Knowledge is tagged by product. Query across products.

```
"What decisions affect both the API and the frontend?"
→ Decision: "Use snake_case for API responses, camelCase in frontend, transform in middleware"
→ Products: ["api", "frontend", "middleware"]

"What are all the breaking constraints for our SDK version?"
→ Constraint: "SDK v6 uses inputSchema not parameters" [api]
→ Constraint: "SDK v6 requires stopWhen instead of maxSteps" [api]
→ Constraint: "Sonnet doesn't support adaptive thinking" [api]
```

### 4. Onboarding — New Team Member on Day 1

**Before:** New developer spends a week reading docs, asking questions, making mistakes that the team already solved.

**After:** First session loads the team's accumulated knowledge. Constraints prevent known mistakes. Decisions explain why things are the way they are.

```
New developer opens the project:
  → "Loading team knowledge..."
  → 12 decisions with reasoning
  → 8 breaking constraints to avoid
  → 15 business rules to follow
  → Product dependency map showing how services connect
```

## Neo4j Browser — Visual Exploration

Open http://localhost:7474 (login: `neo4j` / `knowledge-graph-local`)

### Useful Queries

**See everything:**
```cypher
MATCH (n) WHERE n:Decision OR n:Constraint OR n:Rule RETURN n
```

**All breaking constraints:**
```cypher
MATCH (c:Constraint {severity: 'breaking'})
OPTIONAL MATCH (c)-[:APPLIES_TO]->(t:Technology)
RETURN c.title, c.detail, t.name + '@' + t.version AS tech
```

**Decisions for a specific product:**
```cypher
MATCH (d:Decision)-[:AFFECTS]->(p:Product {name: 'ai-agent'})
RETURN d.title, d.reasoning, d.date
ORDER BY d.date DESC
```

**Product dependency map:**
```cypher
MATCH (a:Product)-[r]->(b:Product)
RETURN a, r, b
```

**Search by keyword:**
```cypher
CALL db.index.fulltext.queryNodes('knowledge_search', 'billing')
YIELD node, score
RETURN labels(node)[0] AS type, node.title, score
ORDER BY score DESC
```

## Team Setup

### Local Team (same network)

Run Neo4j on a shared server:

```bash
# On the server
docker run -d --name team-knowledge-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -v team-knowledge-data:/data \
  -e NEO4J_AUTH=neo4j/your-team-password \
  --restart unless-stopped \
  neo4j:5-community
```

Each team member:
```bash
npm install -g team-knowledge-graph
NEO4J_URI=bolt://your-server:7687 NEO4J_PASSWORD=your-team-password tkg-setup
```

### Cloud (Neo4j Aura)

1. Create a free instance at https://neo4j.com/cloud/aura-free/
2. Each team member:
```bash
npm install -g team-knowledge-graph
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io NEO4J_USER=neo4j NEO4J_PASSWORD=xxx tkg-setup
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j connection URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `knowledge-graph-local` | Neo4j password |

## How It's Different From...

**CLAUDE.md / project docs:**
- Static text files, not searchable, not connected
- Can't query "what affects billing across all products?"
- No temporal history (when was this decided? what did it replace?)

**Codebase Memory MCP:**
- Indexes code structure (functions, classes, imports)
- Doesn't capture WHY decisions were made
- Team Knowledge Graph captures decisions + reasoning + constraints

**RAG / Vector Search:**
- Retrieves text chunks by similarity
- No relationships between concepts
- Team Knowledge Graph is a GRAPH — traverse connections, not just search text

## Uninstall

```bash
npm uninstall -g team-knowledge-graph
docker stop team-knowledge-neo4j && docker rm team-knowledge-neo4j
docker volume rm team-knowledge-neo4j-data
```

Remove the MCP server entry from `~/.claude/.mcp.json` and the SessionStart hook from `~/.claude/settings.json`.

## License

MIT
