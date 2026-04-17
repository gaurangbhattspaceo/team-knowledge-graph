# Team Knowledge Graph

**Your AI coding agents forget everything between sessions — and your team keeps repeating the same feedback. This fixes both.**

Team Knowledge Graph is an MCP server backed by Neo4j. It gives every AI session instant access to your team's accumulated knowledge — decisions, constraints, business rules, design rules, and cross-product relationships — and actively enforces that knowledge the next time someone builds a feature, opens a PR, or runs CI.

## The Two Problems It Solves

### Problem 1: Context loss between sessions

```
Monday:    AI discovers "Sonnet doesn't support tool_search" after 20 min of debugging
Tuesday:   Different session hits the same issue. Another 20 min wasted.
Wednesday: New team member's AI session makes the same mistake again.
```

### Problem 2: Founder/CSM/client feedback that keeps getting missed

```
Week 1:  Founder — "The spacing is inconsistent on the chat screen."
         Team fixes it.
Week 3:  Founder — "Spacing is broken again on the new feature."
         Different engineer built it, didn't know the rule existed.
Week 5:  Founder — "Reminding again about spacing."
         Now everyone's frustrated.
```

### With Team Knowledge Graph

```
Week 1:  Feedback captured once via knowledge_ingest
         → Creates a DesignRule with source = "Founder"
         → Injected at every session start across all 20 repos
Week 3:  New engineer opens Claude Code
         → Sees "REPEATED FEEDBACK: Spacing must be consistent"
         → knowledge_guard flags it before they write code
Week 5:  If still missed, repeat_count hits 3 → becomes a CI gate
         → PR cannot merge without addressing it
         → Founder stops repeating themselves
```

## What It Stores

| Type | Example | When to save |
|---|---|---|
| **Decisions** | "Use Sonnet for simple queries, Opus for plan changes" | When you choose one approach over another |
| **Constraints** | "AI SDK v6 uses `inputSchema` not `parameters`" | When you discover something doesn't work |
| **Business Rules** | "Chat billing: Sonnet = 1 credit, Opus = 8 credits" | When you learn how the business operates |
| **Design Rules** | "Every AI response must have copy + thumbs up/down buttons" | When UX feedback applies to every feature |
| **Platform Rules** | "Same query must produce same answer on web and mobile" | When cross-platform parity matters |
| **Feedback** | Raw feedback from founder/CSM/client + who said it + when | When anyone outside engineering gives actionable input |
| **Relationships** | "AI Agent calls Solver via Bridge webhook" | When you map how products connect |
| **Violations** | Auto-recorded when a rule is broken, triggers escalation | Automatic, no manual save needed |

Everything is stored as a graph in Neo4j — nodes connected by relationships. Query by keyword, filter by product + platform + pattern, explore visually, traverse dependencies.

## Install

**Prerequisites:** Docker Desktop running, Node.js 20+

```bash
npm install -g team-knowledge-graph
tkg-setup
```

The setup wizard:
1. Starts a Neo4j container (Docker)
2. Configures your MCP client to connect automatically
3. Adds a session-start hook that loads relevant knowledge at the beginning of every session
4. Adds instructions so the AI agent saves discoveries in real-time

**Start a new AI coding session — it works immediately.**

## How It Works

### Automatic — No Manual Action Needed

```
┌───────────────────────────────────────────────────────────────┐
│  Session Starts                                                │
│                                                                │
│  Hook runs → queries Neo4j → injects prioritized context:     │
│                                                                │
│    REPEATED FEEDBACK (said 2+ times — do not miss these):     │
│    - Consistent 8px spacing grid [3x, source: Founder]        │
│    - AI responses must have copy button [2x]                  │
│                                                                │
│    Design Rules (must-follow):                                 │
│    - Tool updates render inline: Text > Tool > Text > Tool    │
│                                                                │
│    🔴 Constraints: "AI SDK v6: use inputSchema"               │
│    • Decisions: "Sonnet for 90% queries, Opus for planning"   │
│    • [billing] Rules: "Credits: Sonnet=1, Opus=8"             │
│                                                                │
│  Agent works on your code...                                   │
│                                                                │
│  Before building → calls knowledge_guard                       │
│    → Returns rules that apply to this work                     │
│                                                                │
│  Discovers: "Next.js 16 requires React 19"                    │
│    → Saves to graph via knowledge_constraint                   │
│                                                                │
│  At PR time → knowledge_review                                 │
│    → Flags which rules apply, which are CI gates               │
│                                                                │
│  Session Ends → safety net extracts anything missed            │
└───────────────────────────────────────────────────────────────┘

Next session (same project or different project, same repo or different repo):
  → Starts with everything the team knows, prioritized by pain
```

### The 13 Tools

#### Knowledge capture (4 tools)

##### `knowledge_ingest` — Capture feedback once, enforce forever

```
Source: "Founder Name"
Role: "founder"
Feedback: "Spacing is inconsistent and no copy button on AI responses"
Products: ["chat-app"]
Platforms: ["ios", "android", "web"]
Rules: [
  { title: "Consistent 8px spacing grid", type: "design", severity: "must", scope: "global" },
  { title: "AI responses must have copy button", type: "design", severity: "must", scope: "feature" }
]
```

Creates a `Feedback` node, a `Person` node, and the rules. If any rule title already exists in the graph, increments its `repeat_count` and auto-escalates severity.

##### `knowledge_decide` — Record a decision with reasoning

```
Title: "Use Sonnet for simple queries, Opus for plan changes"
Reasoning: "Sonnet is 5x cheaper. Handles lookups, creates, settings."
Products: ["ai-agent"]
```

##### `knowledge_constraint` — Record something that doesn't work

```
Title: "Sonnet does not support adaptive thinking"
Severity: "breaking"
Technologies: ["anthropic-sdk@3.0.64"]
```

Breaking constraints show with 🔴 at every session start.

##### `knowledge_rule` — Record a business rule

```
Title: "Plan credits: Free=100, Starter=500, Pro=3000, Enterprise=10000"
Domain: "billing"
```

#### Active enforcement (3 tools)

##### `knowledge_guard` — Pre-flight check before building

```
Description: "Adding voice transcription to Android app"
Products: ["chat-app"]
Platforms: ["android"]
Patterns: ["voice", "transcription"]
```

Returns every rule that applies — design rules, platform rules, business rules — sorted by `repeat_count` (most-violated first) then severity. AI agent calls this **before writing code**.

##### `knowledge_review` — Validate a diff/PR against the graph

```
Description: "New chat screen for Android with AI responses and voice input"
Products: ["chat-app"]
Platforms: ["android"]
Files_changed: ["src/screens/Chat.tsx"]
```

Returns applicable rules split by `ci-gate` (must be addressed) and regular rules. Designed for CI integration.

##### `knowledge_violations` — Record + query violations

Recording a violation auto-increments `repeat_count` on the rule and escalates:
- `repeat_count >= 2` → `severity: must`
- `repeat_count >= 3` → `enforcement: ci-gate` (PR cannot merge)

#### Analysis & exploration (5 tools)

##### `knowledge_query` — Search what the team knows

```
"What do we know about billing?"
→ Finds: decision about credit pricing, rule about plan limits,
  constraint about overage not being implemented
```

##### `knowledge_trace` — Explain why a rule exists

```
rule_id: "dr-xyz123"
→ Rule: "AI responses must have thumbs up/down"
→ Origin: Founder, 2026-03-01 — "thumbs up/down button needed"
→ Repeat count: 3
→ Violations: [2026-03-20 chat-android, 2026-04-08 chat-web]
→ Affected products: [chat-app]
```

##### `knowledge_impact` — Cross-product cascade analysis

```
Change: "Modifying response generation logic"
Product: "response-api"
→ Connected products: chat-web, chat-ios, chat-android (all CONSUMES response-api)
→ Rules at risk: "Same query must produce same answer on web and mobile"
```

##### `knowledge_relate` — Map product-to-product relationships

```
From: "chat-web"
To: "response-api"
Relationship: "consumes via POST /chat/stream SSE"
```

##### `knowledge_lint` — Health-check the graph

Finds stale entries, orphan nodes, contradictions, ambiguous entries, and duplicates. Run periodically.

#### Dashboard (1 tool)

##### `knowledge_health` — Compliance dashboard

```
→ Repo: chat-app
  Counts: decisions=12, constraints=8, rules=15, products=4
  Compliance:
    total_rules: 24
    violated_this_month: 4
  Top violations:
    - 8px spacing grid — 5 violations, last: 2026-04-10, source: Founder
    - Copy button on responses — 3 violations, last: 2026-04-08
  Founder repeat feedback: 8 total, 5 still recurring
  Recent: [last 5 entries]
```

Your founder's `still_recurring` count → 0 is the success metric.

## Automatic Escalation

Rules get stronger every time they're repeated or violated:

| Repeat count | What happens |
|---|---|
| **1** | Rule created, injected at session start as must/should/nice-to-have |
| **2** | Auto-promoted to `severity: must`, highlighted prominently in `knowledge_guard` |
| **3+** | Auto-promoted to `enforcement: ci-gate` — PR cannot merge without addressing it |

The system escalates so your founder doesn't have to.

## Use Cases

### 1. Founder/CSM feedback stops getting missed

**Before:** Founder says "fix spacing" → team fixes → new feature breaks it → founder repeats → loop forever.

**After:** `knowledge_ingest` captures the feedback once. Every session, every PR, every engineer sees it. If missed, it auto-escalates to a CI gate after the 3rd repeat.

### 2. Multi-product company — cross-product awareness

**Before:** Team A doesn't know what Team B decided. Integration surprises. "Wait, web shows an answer but mobile doesn't — are we generating answers twice?"

**After:** `knowledge_impact` tells you: "This API is consumed by 3 products. Changing it affects all of them. Here are the 4 rules at risk."

### 3. 20 apps, different tech stacks — one layer to rule them all

**Before:** Can't share lint rules across React, Flutter, SwiftUI, Kotlin. Each stack does its own thing.

**After:** Rules live in the graph, not the tech stack. A DesignRule with `scope: global` applies to every repo regardless of language. Enforcement happens via `knowledge_guard` and `knowledge_review` before code is written or merged.

### 4. Solo developer — stop repeating yourself

**Before:** Every new session, you re-explain your architecture, tech choices, and gotchas.

**After:** Session starts with full context. The AI already knows your stack, your decisions, and what doesn't work.

### 5. Team — shared brain

**Before:** Dev A discovers a limitation on Monday. Dev B hits the same issue on Wednesday. Dev C makes the same mistake next month.

**After:** One Neo4j instance, whole team connected. Discovery by anyone benefits everyone.

### 6. Onboarding — new team member on Day 1

**Before:** New developer spends a week reading docs, asking questions, making mistakes the team already solved.

**After:** First session loads the team's accumulated knowledge. Constraints prevent known mistakes. Decisions explain why things are the way they are.

## Neo4j Browser — Visual Exploration

Open http://localhost:7474 (login: `neo4j` / `knowledge-graph-local`)

### Useful Queries

**See everything:**
```cypher
MATCH (n) WHERE n:Decision OR n:Constraint OR n:Rule OR n:DesignRule OR n:PlatformRule RETURN n
```

**Repeated feedback (most-repeated first):**
```cypher
MATCH (n) WHERE n:DesignRule OR n:PlatformRule OR n:Rule
WHERE COALESCE(n.repeat_count, 1) >= 2
RETURN n.title, n.repeat_count, n.source_name, n.last_violated
ORDER BY n.repeat_count DESC
```

**All breaking constraints:**
```cypher
MATCH (c:Constraint {severity: 'breaking'})
OPTIONAL MATCH (c)-[:APPLIES_TO]->(t:Technology)
RETURN c.title, c.detail, t.name + '@' + t.version AS tech
```

**Design rules for a specific product:**
```cypher
MATCH (d:DesignRule)-[:APPLIES_TO]->(p:Product {name: 'chat-app'})
RETURN d.title, d.severity, d.scope, d.platforms
ORDER BY d.repeat_count DESC
```

**Product dependency map:**
```cypher
MATCH (a:Product)-[r]->(b:Product)
RETURN a, r, b
```

**Trace a rule back to its origin feedback:**
```cypher
MATCH (f:Feedback)-[:GENERATED]->(r {id: 'rule-id-here'})
RETURN f.source_name, f.source_role, f.raw_text, f.date
ORDER BY f.date
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

**Project docs / wiki:**
- Static text files, not searchable, not connected
- Can't query "what affects billing across all products?"
- No enforcement — docs sit unread

**Codebase memory MCPs:**
- Index code structure (functions, classes, imports)
- Don't capture WHY decisions were made, or feedback from non-engineers
- Team Knowledge Graph captures decisions + reasoning + constraints + rules + **the source of each**

**RAG / vector search:**
- Retrieves text chunks by similarity
- No relationships between concepts
- Team Knowledge Graph is a GRAPH — traverse connections, trace origins, analyze cascade impact

**Linters / ESLint / design tokens:**
- Enforce rules at the file level, in a specific language/stack
- Can't span 20 apps across different tech stacks
- Team Knowledge Graph enforces at the semantic level (product + platform + pattern) regardless of stack

## Upgrading from v0.1.x

v0.2.0 is additive — no breaking data changes. One tool renamed:

- `knowledge_status` → `knowledge_health` (same schema, new fields added)

Existing decisions, constraints, rules, and relationships remain. New capabilities become available as you use the new tools.

## Uninstall

```bash
npm uninstall -g team-knowledge-graph
docker stop team-knowledge-neo4j && docker rm team-knowledge-neo4j
docker volume rm team-knowledge-neo4j-data
```

Remove the MCP server entry from `~/.claude/.mcp.json` and the SessionStart hook from `~/.claude/settings.json`.

## License

MIT
