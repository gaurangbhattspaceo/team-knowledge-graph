# TKG v2: Active Knowledge Enforcer

**Date:** 2026-04-16
**Status:** Approved

## Problem

Product companies with multiple apps (3 SaaS products, 20 apps, mixed tech stacks) lose feedback from founders, CSMs, and clients. Rules get stated, forgotten, violated, and restated. No single layer spans all repos, stacks, and platforms to enforce institutional knowledge.

### Root Cause

Knowledge flows down (founder/CSM/client feedback) but has no persistent enforcement mechanism. Today's TKG stores knowledge passively — it only speaks when someone asks. Nobody queries before building, nobody checks during PR review, nobody validates after deploy.

### Real-World Examples (Founder Feedback)

- "Reminding again about spacing issues" — repeated 3+ times
- "No copy, thumbs up/down option" — missing standard components
- "When screen finishes it goes below input box" — layout bug repeated across features
- "Tool updates keep coming in one row, not like web" — platform inconsistency
- "iOS transcription seems more natural" — Android/iOS parity gap
- "Same query has got answer on web, mobile doesn't show answer" — backend response inconsistency
- "Are you generating answers 2 times? For web and mobile?" — cross-product confusion

Every one of these is a rule that should be captured once and enforced forever.

## Solution

Evolve TKG from a passive knowledge store into an active knowledge enforcer — the persistent brain that any AI agent, CI pipeline, or session can plug into across all products, platforms, and tech stacks.

## New Node Types

### DesignRule

UI/UX rules with platform, scope, and pattern awareness. Not a Figma file or component library — a rule in the knowledge graph enforced the same way business rules are.

```
DesignRule {
  id: string,
  title: string,
  detail: string | null,
  severity: "must" | "should" | "nice-to-have",
  scope: "global" | "product" | "feature" | "screen",
  platforms: string[],           // ["ios", "android", "web", "all"]
  patterns: string[],            // ["chat-ui", "voice", "payment", ...]
  source: { name: string, role: string, date: string },
  enforcement: "automated" | "manual-check" | "ci-gate",
  repeat_count: number,
  last_violated: string | null,
  date: string,
  createdBy: string,
  confidence: "explicit" | "inferred" | "ambiguous",
  status: "active" | "superseded" | "stale"
}
```

Examples:
- "Consistent 8px spacing grid across all platforms" — scope: global, platform: all
- "Every AI response must have copy button + thumbs up/down" — scope: chat-ui, platform: all
- "Tool updates render inline: Text > Tool > Text > Tool" — scope: chat-ui, platform: mobile
- "Chat content must never render below the input box" — scope: chat-ui, platform: all

### PlatformRule

Cross-platform parity rules.

```
PlatformRule {
  id: string,
  title: string,
  detail: string | null,
  severity: "must" | "should" | "nice-to-have",
  platforms: string[],
  reference_platform: string | null,   // e.g. "ios" = the gold standard
  source: { name: string, role: string, date: string },
  enforcement: "automated" | "manual-check" | "ci-gate",
  repeat_count: number,
  last_violated: string | null,
  date: string,
  createdBy: string,
  confidence: "explicit" | "inferred" | "ambiguous",
  status: "active" | "superseded" | "stale"
}
```

Examples:
- "Transcription behavior must match iOS on all platforms" — reference: iOS
- "Same query must produce same answer on web and mobile" — platform: all

### Feedback

Captures the source of knowledge. Links to the rules it generates.

```
Feedback {
  id: string,
  source_name: string,
  source_role: "founder" | "csm" | "client" | "engineer" | "user",
  raw_text: string,
  products: string[],
  platforms: string[],
  date: string,
  rules_generated: string[]   // IDs of rules created from this feedback
}
```

### Violation

Tracks when rules are broken.

```
Violation {
  id: string,
  rule_id: string,
  repo: string,
  product: string,
  platform: string,
  detected_by: "ci" | "review" | "repeated-feedback" | "guard",
  resolved: boolean,
  date: string
}
```

## New Relationship Types

| Relationship | Between | Example |
|---|---|---|
| `GAVE` | Person -> Feedback | Founder -> spacing feedback |
| `GENERATED` | Feedback -> DesignRule/PlatformRule/Rule | Feedback decomposes into rules |
| `VIOLATES` | Violation -> DesignRule/PlatformRule/Rule | Tracks violations |
| `OCCURRED_IN` | Violation -> Repo | Which repo had the violation |
| `CONSUMES` | Product -> Product/Service | Mobile app -> backend API |
| `SHARES_BACKEND` | Product <-> Product | Web and mobile share same API |
| `SHARES_COMPONENT` | Product <-> Product | iOS and Android share UI kit |
| `FEEDS_DATA_TO` | Service -> Service | LLM service -> response API |
| `MUST_MATCH` | Product <-> Product | Web chat must match mobile chat |

Existing relationships are preserved: `DISCOVERED_IN`, `AFFECTS`, `TOUCHES`, `BELONGS_TO`, `USES`, `GOVERNS`, `APPLIES_TO`, `RELATES_TO`, `RELATED_TO`, `SUPERSEDES`.

## New Tools

### knowledge_ingest

Capture feedback from founder/CSM/client. Auto-decompose into rules. Detect repeats.

**Schema:**
```typescript
z.object({
  source: z.string(),                    // "Founder Name"
  role: z.enum(["founder", "csm", "client", "engineer", "user"]),
  feedback: z.string(),                  // Raw feedback text
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
})
```

**Schema also accepts pre-decomposed rules:**
```typescript
z.object({
  source: z.string(),
  role: z.enum(["founder", "csm", "client", "engineer", "user"]),
  feedback: z.string(),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  rules: z.array(z.object({
    title: z.string(),
    type: z.enum(["design", "platform", "business"]),
    severity: z.enum(["must", "should", "nice-to-have"]).optional(),
    scope: z.enum(["global", "product", "feature", "screen"]).optional(),
    patterns: z.array(z.string()).optional(),
  })).optional(),
})
```

**Behavior:**
The AI agent reads the raw feedback, decomposes it into individual rules, and passes them in the `rules` array. The tool does not call an LLM — it structures and stores what the AI provides. If `rules` is omitted, the tool stores the feedback and returns it for the AI to decompose in a follow-up call.

1. Create `Feedback` node with source, date, raw text
2. Create `Person` node (MERGE) for the source, link via `GAVE`
3. For each rule in the `rules` array: check if similar rule already exists in graph (fulltext search on title)
   - If exists: increment `repeat_count`, create `Violation` node (detected_by: "repeated-feedback"), link feedback to existing rule via `GENERATED`
   - If new: create `DesignRule`, `PlatformRule`, or `Rule` node based on `type`, link to feedback via `GENERATED`
4. Link rules to products and platforms
5. Return: rules created, rules matched as repeats, repeat counts

### knowledge_guard

Pre-flight check before building. Returns all applicable rules for the work about to be done.

**Schema:**
```typescript
z.object({
  description: z.string(),              // What you're about to build
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),  // ["chat-ui", "voice", "payment"]
})
```

**Behavior:**
1. Query graph for all rules matching product + platform + patterns
2. Include global rules (scope: "global")
3. Sort by: repeat_count DESC, severity (must > should > nice-to-have)
4. Return structured list grouped by severity
5. Highlight rules with repeat_count >= 2 as "REPEATED FEEDBACK"

### knowledge_review

Validate a diff/PR against the rule graph. Designed for CI integration.

**Schema:**
```typescript
z.object({
  description: z.string(),              // What changed
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  files_changed: z.array(z.string()).optional(),
})
```

**Behavior:**
1. Query all rules for the given products + platforms
2. For each rule, classify as:
   - `violated` — the change contradicts or doesn't include what the rule requires
   - `compliant` — the change follows the rule
   - `needs_manual_check` — can't determine automatically (enforcement: "manual-check")
   - `not_applicable` — rule doesn't apply to this change
3. Create `Violation` nodes for violations (detected_by: "ci" or "review")
4. Return violations, compliant, warnings

Note: The AI agent does the semantic matching between the change description and rules. The tool structures the output and records violations in the graph.

### knowledge_trace

Explain why a rule exists. Show its history and repeat count.

**Schema:**
```typescript
z.object({
  rule_id: z.string(),
})
```

**Behavior:**
1. Fetch rule node + all connected `Feedback` nodes via `GENERATED` relationship
2. Fetch all `Violation` nodes via `VIOLATES` relationship
3. Return: rule details, origin (who said it, when), repeat count, violation history, affected products/platforms, related rules

### knowledge_impact

Cross-product cascade analysis. Given a change in one product, show what else is affected.

**Schema:**
```typescript
z.object({
  change: z.string(),                   // Description of the change
  product: z.string(),
  platform: z.string().optional(),
})
```

**Behavior:**
1. Find the product in the graph
2. Traverse `CONSUMES`, `SHARES_BACKEND`, `SHARES_COMPONENT`, `FEEDS_DATA_TO`, `MUST_MATCH` relationships to find connected products
3. For each connected product, find rules that apply
4. Return: directly affected products, cascade-affected products (with reason), rules at risk, shared dependencies

### knowledge_violations

Record and query rule violations.

**Schema:**
```typescript
z.object({
  action: z.enum(["record", "query"]),
  // For record:
  rule_id: z.string().optional(),
  repo: z.string().optional(),
  product: z.string().optional(),
  platform: z.string().optional(),
  detected_by: z.enum(["ci", "review", "repeated-feedback", "guard"]).optional(),
  // For query:
  scope: z.enum(["repo", "product", "global"]).optional(),
})
```

**Behavior (record):**
1. Create `Violation` node
2. Increment `repeat_count` on the violated rule
3. Update `last_violated` on the rule
4. If `repeat_count` reaches 3, auto-escalate rule `enforcement` to "ci-gate"

**Behavior (query):**
1. Return violations filtered by scope
2. Include aggregates: total, by rule, by repo, by product

## Upgraded Existing Tool

### knowledge_status -> knowledge_health

Extends current status with compliance metrics.

**Added to output:**
```typescript
{
  // Existing fields preserved
  compliance: {
    total_rules: number,
    verified: number,
    violated_this_month: number,
    never_verified: number,
  },
  top_violations: Array<{
    rule: string,
    violations: number,
    last: string,
    source: string,
    affected_repos: string[],
  }>,
  most_compliant_repo: string,
  least_compliant_repo: string,
  founder_repeat_feedback: {
    total: number,
    resolved: number,
    still_recurring: number,
  },
}
```

## Enhanced Rule Schema

All rule types (`Rule`, `DesignRule`, `PlatformRule`) share these fields:

| Field | Type | Purpose |
|---|---|---|
| `severity` | "must" / "should" / "nice-to-have" | How strictly to enforce |
| `scope` | "global" / "product" / "feature" / "screen" | Where it applies |
| `platforms` | string[] | Which platforms |
| `patterns` | string[] | What kind of work triggers this rule |
| `source` | { name, role, date } | Who said it and when |
| `enforcement` | "automated" / "manual-check" / "ci-gate" | How to enforce |
| `repeat_count` | number | How many times this has been stated |
| `last_violated` | string or null | When it was last missed |

## Automatic Escalation

Based on `repeat_count`:

| Count | Action |
|---|---|
| 1 | Rule created, injected at session start |
| 2 | Auto-promoted to `severity: "must"`, highlighted prominently in `knowledge_guard` |
| 3+ | Auto-promoted to `enforcement: "ci-gate"`, PR cannot merge without addressing it |

## Smart Session Injection

The `bin/session-start.js` hook becomes context-aware.

**Step 1 — Identify context:**
Detect repo, map to products and platforms.

**Step 2 — Query graph with priority ordering:**
1. MUST rules with `repeat_count >= 2` (founder said this twice — don't miss it)
2. MUST rules for this product + platform (non-negotiable)
3. Global design rules (8px spacing, always)
4. Recent constraints for this repo (known limitations)
5. Active decisions affecting this product (architectural context)

**Step 3 — Format as structured injection:**
```
REPEATED FEEDBACK (said 2+ times):
  - [rule title] [count]x, last: [date]

DESIGN RULES for [product] / [platform]:
  - [rule titles]

ACTIVE CONSTRAINTS:
  - [constraint titles]

RECENT DECISIONS:
  - [decision titles]
```

**Step 4 — Product-specific briefings:**
Each of the 20 repos gets a tailored injection. Engineers in the billing repo don't see chat-ui rules. Engineers in the Android app see what the founder has been frustrated about.

## Neo4j Schema Changes

### New constraints
```cypher
CREATE CONSTRAINT designrule_id IF NOT EXISTS FOR (d:DesignRule) REQUIRE d.id IS UNIQUE
CREATE CONSTRAINT platformrule_id IF NOT EXISTS FOR (p:PlatformRule) REQUIRE p.id IS UNIQUE
CREATE CONSTRAINT feedback_id IF NOT EXISTS FOR (f:Feedback) REQUIRE f.id IS UNIQUE
CREATE CONSTRAINT violation_id IF NOT EXISTS FOR (v:Violation) REQUIRE v.id IS UNIQUE
CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE
```

### Updated fulltext index
```cypher
CREATE FULLTEXT INDEX knowledge_search IF NOT EXISTS
FOR (n:Decision|Constraint|Rule|DesignRule|PlatformRule)
ON EACH [n.title, n.detail, n.reasoning]
```

## Tool Count

| Existing (7) | New (6) | Total: 13 |
|---|---|---|
| knowledge_decide | knowledge_ingest | |
| knowledge_constraint | knowledge_guard | |
| knowledge_rule | knowledge_review | |
| knowledge_query | knowledge_trace | |
| knowledge_relate | knowledge_impact | |
| knowledge_status (upgraded to knowledge_health) | knowledge_violations | |
| knowledge_lint | | |

## Success Metric

**Founder repeat feedback count -> 0 over time.**

Every feedback captured once, enforced forever. The system escalates automatically when rules are missed. The founder stops repeating himself because the graph remembers and enforces for him.

## What Stays the Same

- All 7 existing tools remain with backward-compatible schemas
- Existing graph data is preserved — all changes are additive
- Neo4j as the backing store
- MCP as the protocol
- Session-start/end hooks architecture
- CLI entry points (tkg, tkg-setup)

## Implementation Order (Suggested)

1. **New node types + schema** — DesignRule, PlatformRule, Feedback, Violation + Neo4j constraints
2. **knowledge_ingest** — the entry point for all feedback (highest value, immediate use)
3. **knowledge_guard** — pre-flight checks (prevents violations during coding)
4. **Enhanced session injection** — smart, context-aware startup
5. **knowledge_review** — PR/CI validation (catches what guard missed)
6. **knowledge_violations + escalation** — tracking + auto-escalation logic
7. **knowledge_health** — upgrade status to compliance dashboard
8. **knowledge_trace** — explain rule origins
9. **knowledge_impact** — cross-product cascade analysis
10. **knowledge_review CI integration** — hook into PR pipelines
