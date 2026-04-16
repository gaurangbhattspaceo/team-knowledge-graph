# TKG v2: Active Knowledge Enforcer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve TKG from a passive knowledge store into an active knowledge enforcer that captures feedback once and enforces it forever across all products, platforms, and tech stacks.

**Architecture:** Additive changes to the existing MCP server. 4 new Neo4j node types (DesignRule, PlatformRule, Feedback, Violation), 6 new tools, 1 upgraded tool, enhanced session-start hook. All existing tools and data remain untouched. Each tool follows the established pattern: zod schema + async function + Neo4j session.

**Tech Stack:** TypeScript, Neo4j 5, MCP SDK, zod, node:test for integration tests

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `src/tools/ingest.ts` | `knowledge_ingest` — capture feedback, decompose into rules, detect repeats |
| `src/tools/guard.ts` | `knowledge_guard` — pre-flight check, return applicable rules |
| `src/tools/review.ts` | `knowledge_review` — validate changes against rule graph |
| `src/tools/trace.ts` | `knowledge_trace` — explain rule origin and history |
| `src/tools/impact.ts` | `knowledge_impact` — cross-product cascade analysis |
| `src/tools/violations.ts` | `knowledge_violations` — record and query violations |
| `tests/ingest.test.ts` | Integration tests for ingest |
| `tests/guard.test.ts` | Integration tests for guard |
| `tests/review.test.ts` | Integration tests for review |
| `tests/trace.test.ts` | Integration tests for trace |
| `tests/impact.test.ts` | Integration tests for impact |
| `tests/violations.test.ts` | Integration tests for violations |
| `tests/health.test.ts` | Integration tests for upgraded health |
| `tests/session-start.test.ts` | Integration tests for smart injection |

### Modified files
| File | Change |
|---|---|
| `src/neo4j.ts` | Add new constraints + updated fulltext index for DesignRule, PlatformRule, Feedback, Violation, Person |
| `src/server.ts` | Register 6 new tools, rename status to health |
| `src/tools/status.ts` | Upgrade to `knowledge_health` with compliance metrics |
| `src/types.ts` | Add shared enums/types for severity, scope, enforcement, platforms |
| `bin/session-start.js` | Smart context-aware injection with priority ordering |
| `tests/tools.test.ts` | Keep existing, update status test to health |
| `package.json` | Bump version to 0.2.0 |

---

## Task 1: Extend Neo4j Schema & Shared Types

**Files:**
- Modify: `src/neo4j.ts:31-44`
- Modify: `src/types.ts`

- [ ] **Step 1: Add shared types and enums to `src/types.ts`**

```typescript
// Add after existing exports in src/types.ts

export const severityEnum = ['must', 'should', 'nice-to-have'] as const;
export type Severity = typeof severityEnum[number];

export const scopeEnum = ['global', 'product', 'feature', 'screen'] as const;
export type Scope = typeof scopeEnum[number];

export const enforcementEnum = ['automated', 'manual-check', 'ci-gate'] as const;
export type Enforcement = typeof enforcementEnum[number];

export const platformEnum = ['ios', 'android', 'web', 'all'] as const;
export type Platform = typeof platformEnum[number];

export const sourceRoleEnum = ['founder', 'csm', 'client', 'engineer', 'user'] as const;
export type SourceRole = typeof sourceRoleEnum[number];
```

- [ ] **Step 2: Add new constraints and updated fulltext index to `src/neo4j.ts`**

Add these to the `SCHEMA_STATEMENTS` array:

```typescript
'CREATE CONSTRAINT designrule_id IF NOT EXISTS FOR (d:DesignRule) REQUIRE d.id IS UNIQUE',
'CREATE CONSTRAINT platformrule_id IF NOT EXISTS FOR (p:PlatformRule) REQUIRE p.id IS UNIQUE',
'CREATE CONSTRAINT feedback_id IF NOT EXISTS FOR (f:Feedback) REQUIRE f.id IS UNIQUE',
'CREATE CONSTRAINT violation_id IF NOT EXISTS FOR (v:Violation) REQUIRE v.id IS UNIQUE',
'CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE',
```

Replace the `FULLTEXT_INDEX` constant with:

```typescript
const FULLTEXT_INDEX = `
  CREATE FULLTEXT INDEX knowledge_search IF NOT EXISTS
  FOR (n:Decision|Constraint|Rule|DesignRule|PlatformRule)
  ON EACH [n.title, n.detail, n.reasoning]
`;
```

- [ ] **Step 3: Build and verify schema initializes**

Run: `npm run build && node -e "const {verifyConnection,initSchema,closeDriver}=require('./dist/neo4j.js'); verifyConnection().then(ok=>{if(ok)return initSchema();}).then(()=>closeDriver()).catch(e=>{console.error(e);process.exit(1)})"`

Expected: `[Knowledge] Schema initialized` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/neo4j.ts
git commit -m "feat: add neo4j schema for DesignRule, PlatformRule, Feedback, Violation, Person nodes"
```

---

## Task 2: `knowledge_ingest` Tool

**Files:**
- Create: `src/tools/ingest.ts`
- Create: `tests/ingest.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/ingest.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_ingest (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-ingest' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-ingest' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('ingests feedback and creates design rules', async () => {
    const result = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Spacing is inconsistent and no copy button on AI responses',
      products: ['test-chat-app'],
      platforms: ['ios', 'android', 'web'],
      rules: [
        { title: 'Consistent 8px spacing grid', type: 'design', severity: 'must', scope: 'global', patterns: ['spacing'] },
        { title: 'AI responses must have copy button', type: 'design', severity: 'must', scope: 'feature', patterns: ['chat-ui'] },
      ],
    }, testRepo);

    assert.ok(result.feedback_id, 'Should return feedback ID');
    assert.strictEqual(result.rules_created, 2, 'Should create 2 rules');
    assert.strictEqual(result.rules_repeated, 0, 'No repeats on first ingest');

    // Tag for cleanup
    const session = getSession();
    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-ingest'", { id: result.feedback_id });
    for (const ruleId of result.rule_ids) {
      await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-ingest'", { id: ruleId });
    }
    await session.close();
  });

  it('detects repeated feedback and increments repeat_count', async () => {
    // First ingest
    const first = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Fix the spacing please',
      products: ['test-chat-app'],
      platforms: ['all'],
      rules: [
        { title: 'Consistent 8px spacing grid', type: 'design', severity: 'must', scope: 'global', patterns: ['spacing'] },
      ],
    }, testRepo);

    // Tag for cleanup
    const session = getSession();
    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-ingest'", { id: first.feedback_id });
    for (const ruleId of first.rule_ids) {
      await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-ingest'", { id: ruleId });
    }

    // Second ingest — same rule title, should detect repeat
    const second = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Spacing is still broken',
      products: ['test-chat-app'],
      platforms: ['all'],
      rules: [
        { title: 'Consistent 8px spacing grid', type: 'design', severity: 'must', scope: 'global', patterns: ['spacing'] },
      ],
    }, testRepo);

    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-ingest'", { id: second.feedback_id });

    assert.strictEqual(second.rules_repeated, 1, 'Should detect 1 repeated rule');
    assert.ok(second.repeat_details.length > 0, 'Should include repeat details');
    assert.ok(second.repeat_details[0].repeat_count >= 2, 'repeat_count should be >= 2');

    await session.close();
  });

  it('stores feedback without rules array and returns for decomposition', async () => {
    const result = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Voice activation is confusing on Android',
      products: ['test-chat-app'],
      platforms: ['android'],
    }, testRepo);

    assert.ok(result.feedback_id, 'Should return feedback ID');
    assert.strictEqual(result.rules_created, 0, 'No rules created without rules array');
    assert.strictEqual(result.needs_decomposition, true, 'Should flag for decomposition');

    const session = getSession();
    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-ingest'", { id: result.feedback_id });
    await session.close();
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/ingest.test.ts 2>&1 | head -20`

Expected: FAIL — module `../dist/tools/ingest.js` not found.

- [ ] **Step 3: Implement `src/tools/ingest.ts`**

```typescript
import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

const ruleItemSchema = z.object({
  title: z.string(),
  type: z.enum(['design', 'platform', 'business']),
  severity: z.enum(['must', 'should', 'nice-to-have']).optional().default('must'),
  scope: z.enum(['global', 'product', 'feature', 'screen']).optional().default('product'),
  patterns: z.array(z.string()).optional(),
});

export const ingestSchema = z.object({
  source: z.string().describe('Name of the person giving feedback'),
  role: z.enum(['founder', 'csm', 'client', 'engineer', 'user']).describe('Role of the feedback source'),
  feedback: z.string().describe('Raw feedback text'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  rules: z.array(ruleItemSchema).optional().describe('Pre-decomposed rules from the feedback. If omitted, feedback is stored and returned for the AI to decompose in a follow-up call.'),
});

export type IngestInput = z.infer<typeof ingestSchema>;

interface RepeatDetail {
  rule_id: string;
  title: string;
  repeat_count: number;
}

interface IngestResult {
  feedback_id: string;
  rules_created: number;
  rules_repeated: number;
  rule_ids: string[];
  repeat_details: RepeatDetail[];
  needs_decomposition: boolean;
}

const NODE_LABEL: Record<string, string> = {
  design: 'DesignRule',
  platform: 'PlatformRule',
  business: 'Rule',
};

export async function ingest(input: IngestInput, repo: RepoInfo | null): Promise<IngestResult> {
  const feedbackId = generateId();
  const date = new Date().toISOString().split('T')[0];
  const session = getSession();
  const ruleIds: string[] = [];
  let rulesCreated = 0;
  let rulesRepeated = 0;
  const repeatDetails: RepeatDetail[] = [];

  try {
    // 1. Create Feedback node
    await session.run(
      `CREATE (f:Feedback {
        id: $id,
        source_name: $source,
        source_role: $role,
        raw_text: $feedback,
        products: $products,
        platforms: $platforms,
        date: $date
      })`,
      {
        id: feedbackId,
        source: input.source,
        role: input.role,
        feedback: input.feedback,
        products: input.products ?? [],
        platforms: input.platforms ?? [],
        date,
      }
    );

    // 2. Create/merge Person node and link via GAVE
    await session.run(
      `MERGE (p:Person {name: $name})
       SET p.role = $role
       WITH p
       MATCH (f:Feedback {id: $feedbackId})
       CREATE (p)-[:GAVE]->(f)`,
      { name: input.source, role: input.role, feedbackId }
    );

    // 3. Link to Repo
    if (repo) {
      await session.run(
        `MERGE (r:Repo {url: $url}) SET r.name = $name
         WITH r
         MATCH (f:Feedback {id: $feedbackId})
         CREATE (f)-[:DISCOVERED_IN]->(r)`,
        { url: repo.url, name: repo.name, feedbackId }
      );
    }

    // 4. Process rules if provided
    if (input.rules && input.rules.length > 0) {
      for (const ruleItem of input.rules) {
        const label = NODE_LABEL[ruleItem.type];

        // Check for existing similar rule via fulltext search
        let existingId: string | null = null;
        try {
          const searchResult = await session.run(
            `CALL db.index.fulltext.queryNodes('knowledge_search', $searchTerms) YIELD node, score
             WHERE score > 2.0 AND $label IN labels(node)
             RETURN node.id AS id, node.title AS title, node.repeat_count AS repeat_count
             LIMIT 1`,
            { searchTerms: ruleItem.title, label }
          );
          if (searchResult.records.length > 0) {
            existingId = searchResult.records[0].get('id') as string;
          }
        } catch { /* fulltext not ready — treat as new */ }

        if (existingId) {
          // Repeated rule — increment repeat_count, create violation
          const updateResult = await session.run(
            `MATCH (n {id: $id})
             SET n.repeat_count = COALESCE(n.repeat_count, 1) + 1
             WITH n
             MATCH (f:Feedback {id: $feedbackId})
             CREATE (f)-[:GENERATED]->(n)
             RETURN n.repeat_count AS repeat_count, n.title AS title`,
            { id: existingId, feedbackId }
          );

          const repeatCount = typeof updateResult.records[0].get('repeat_count') === 'object'
            ? (updateResult.records[0].get('repeat_count') as any).toNumber()
            : Number(updateResult.records[0].get('repeat_count'));

          // Create violation node for the repeat
          const violationId = generateId();
          await session.run(
            `CREATE (v:Violation {
              id: $violationId,
              rule_id: $ruleId,
              repo: $repo,
              product: $product,
              platform: $platform,
              detected_by: 'repeated-feedback',
              resolved: false,
              date: $date
            })
            WITH v
            MATCH (n {id: $ruleId})
            CREATE (v)-[:VIOLATES]->(n)`,
            {
              violationId,
              ruleId: existingId,
              repo: repo?.name ?? '',
              product: (input.products ?? [])[0] ?? '',
              platform: (input.platforms ?? [])[0] ?? '',
              date,
            }
          );

          // Auto-escalate: 2nd repeat -> must, 3rd+ -> ci-gate
          if (repeatCount >= 3) {
            await session.run(
              `MATCH (n {id: $id}) SET n.enforcement = 'ci-gate', n.severity = 'must'`,
              { id: existingId }
            );
          } else if (repeatCount >= 2) {
            await session.run(
              `MATCH (n {id: $id}) SET n.severity = 'must'`,
              { id: existingId }
            );
          }

          ruleIds.push(existingId);
          rulesRepeated++;
          repeatDetails.push({
            rule_id: existingId,
            title: updateResult.records[0].get('title') as string,
            repeat_count: repeatCount,
          });
        } else {
          // New rule — create node
          const ruleId = generateId();
          await session.run(
            `CREATE (n:${label} {
              id: $id,
              title: $title,
              detail: null,
              severity: $severity,
              scope: $scope,
              platforms: $platforms,
              patterns: $patterns,
              source_name: $sourceName,
              source_role: $sourceRole,
              source_date: $date,
              enforcement: 'automated',
              repeat_count: 1,
              last_violated: null,
              date: $date,
              createdBy: 'ai-agent',
              confidence: 'explicit',
              status: 'active'
            })`,
            {
              id: ruleId,
              title: ruleItem.title,
              severity: ruleItem.severity ?? 'must',
              scope: ruleItem.scope ?? 'product',
              platforms: input.platforms ?? [],
              patterns: ruleItem.patterns ?? [],
              sourceName: input.source,
              sourceRole: input.role,
              date,
            }
          );

          // Link feedback -> rule via GENERATED
          await session.run(
            `MATCH (f:Feedback {id: $feedbackId}), (n {id: $ruleId})
             CREATE (f)-[:GENERATED]->(n)`,
            { feedbackId, ruleId }
          );

          // Link to products via APPLIES_TO
          if (input.products) {
            for (const product of input.products) {
              await session.run(
                `MERGE (p:Product {name: $name})
                 WITH p
                 MATCH (n {id: $ruleId})
                 CREATE (n)-[:APPLIES_TO]->(p)`,
                { name: product, ruleId }
              );
            }
          }

          ruleIds.push(ruleId);
          rulesCreated++;
        }
      }
    }

    return {
      feedback_id: feedbackId,
      rules_created: rulesCreated,
      rules_repeated: rulesRepeated,
      rule_ids: ruleIds,
      repeat_details: repeatDetails,
      needs_decomposition: !input.rules || input.rules.length === 0,
    };
  } finally {
    await session.close();
  }
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import at the top:

```typescript
import { ingestSchema, ingest } from './tools/ingest.js';
```

Add tool registration after the existing tools:

```typescript
server.tool('knowledge_ingest', 'Capture feedback from founder/CSM/client. Auto-decomposes into design rules, platform rules, or business rules. Detects repeated feedback and auto-escalates severity.', ingestSchema.shape, async (args) => {
  const result = await ingest(ingestSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/ingest.test.ts`

Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/ingest.ts src/server.ts tests/ingest.test.ts
git commit -m "feat: add knowledge_ingest tool — capture feedback, create rules, detect repeats"
```

---

## Task 3: `knowledge_guard` Tool

**Files:**
- Create: `src/tools/guard.ts`
- Create: `tests/guard.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/guard.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { guard } from '../dist/tools/guard.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_guard (integration)', () => {
  let createdIds: string[] = [];

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    // Seed rules via ingest
    const r1 = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Spacing must be consistent',
      products: ['guard-test-app'],
      platforms: ['all'],
      rules: [
        { title: 'Guard test: 8px spacing grid', type: 'design', severity: 'must', scope: 'global', patterns: ['spacing', 'layout'] },
      ],
    }, testRepo);
    createdIds.push(r1.feedback_id, ...r1.rule_ids);

    const r2 = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Copy button needed',
      products: ['guard-test-app'],
      platforms: ['ios', 'android'],
      rules: [
        { title: 'Guard test: AI responses need copy button', type: 'design', severity: 'must', scope: 'feature', patterns: ['chat-ui'] },
      ],
    }, testRepo);
    createdIds.push(r2.feedback_id, ...r2.rule_ids);

    // Tag for cleanup
    const session = getSession();
    for (const id of createdIds) {
      await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-guard'", { id });
    }
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-guard' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('returns applicable rules for a product + pattern', async () => {
    const result = await guard({
      description: 'Building a new chat screen',
      products: ['guard-test-app'],
      platforms: ['ios'],
      patterns: ['chat-ui'],
    }, testRepo);

    assert.ok(result.rules.length >= 1, 'Should return at least 1 rule');
    const titles = result.rules.map((r: any) => r.title);
    assert.ok(titles.some((t: string) => t.includes('copy button')), 'Should include chat-ui rule');
  });

  it('includes global rules even without matching pattern', async () => {
    const result = await guard({
      description: 'Building a settings page',
      products: ['guard-test-app'],
      platforms: ['all'],
      patterns: ['settings'],
    }, testRepo);

    assert.ok(result.rules.length >= 1, 'Should return at least 1 global rule');
    const titles = result.rules.map((r: any) => r.title);
    assert.ok(titles.some((t: string) => t.includes('spacing')), 'Should include global spacing rule');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/guard.test.ts 2>&1 | head -10`

Expected: FAIL — module `../dist/tools/guard.js` not found.

- [ ] **Step 3: Implement `src/tools/guard.ts`**

```typescript
import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const guardSchema = z.object({
  description: z.string().describe('What you are about to build or change'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional().describe('Feature patterns like chat-ui, voice, payment, onboarding'),
});

export type GuardInput = z.infer<typeof guardSchema>;

interface GuardRule {
  type: string;
  id: string;
  title: string;
  severity: string;
  scope: string;
  platforms: string[];
  patterns: string[];
  source_name: string;
  repeat_count: number;
  enforcement: string;
}

interface GuardResult {
  rules: GuardRule[];
  repeated_warnings: GuardRule[];
  total: number;
}

export async function guard(input: GuardInput, _repo: RepoInfo | null): Promise<GuardResult> {
  const session = getSession();

  try {
    const inputPlatforms = input.platforms ?? ['all'];
    const inputPatterns = input.patterns ?? [];
    const inputProducts = input.products ?? [];

    // Query all active DesignRules, PlatformRules, and Rules that match product + platform + patterns
    const cypher = `
      MATCH (n)
      WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
      AND COALESCE(n.status, 'active') = 'active'
      AND (
        n.scope = 'global'
        OR (
          $hasProducts = false
          OR EXISTS {
            MATCH (n)-[:APPLIES_TO]->(p:Product)
            WHERE p.name IN $products
          }
        )
      )
      AND (
        $hasPlatforms = false
        OR ANY(plat IN COALESCE(n.platforms, []) WHERE plat IN $platforms OR plat = 'all')
        OR 'all' IN $platforms
      )
      OPTIONAL MATCH (n)-[:APPLIES_TO]->(p:Product)
      WITH n, collect(DISTINCT p.name) AS products,
           [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule','Rule']][0] AS type
      RETURN type,
             n.id AS id,
             n.title AS title,
             COALESCE(n.severity, 'should') AS severity,
             COALESCE(n.scope, 'product') AS scope,
             COALESCE(n.platforms, []) AS platforms,
             COALESCE(n.patterns, []) AS patterns,
             COALESCE(n.source_name, '') AS source_name,
             COALESCE(n.repeat_count, 1) AS repeat_count,
             COALESCE(n.enforcement, 'automated') AS enforcement
      ORDER BY n.repeat_count DESC,
               CASE n.severity WHEN 'must' THEN 0 WHEN 'should' THEN 1 ELSE 2 END ASC,
               n.date DESC
    `;

    const result = await session.run(cypher, {
      products: inputProducts,
      platforms: inputPlatforms,
      hasProducts: inputProducts.length > 0,
      hasPlatforms: inputPlatforms.length > 0,
    });

    const rules: GuardRule[] = result.records.map((rec) => ({
      type: rec.get('type') as string,
      id: rec.get('id') as string,
      title: rec.get('title') as string,
      severity: rec.get('severity') as string,
      scope: rec.get('scope') as string,
      platforms: rec.get('platforms') as string[],
      patterns: rec.get('patterns') as string[],
      source_name: rec.get('source_name') as string,
      repeat_count: toNum(rec.get('repeat_count')),
      enforcement: rec.get('enforcement') as string,
    }));

    // Filter by pattern if patterns provided (post-query filter for flexibility)
    let filtered = rules;
    if (inputPatterns.length > 0) {
      filtered = rules.filter((r) =>
        r.scope === 'global'
        || r.patterns.length === 0
        || r.patterns.some((p) => inputPatterns.includes(p))
      );
    }

    const repeatedWarnings = filtered.filter((r) => r.repeat_count >= 2);

    return {
      rules: filtered,
      repeated_warnings: repeatedWarnings,
      total: filtered.length,
    };
  } finally {
    await session.close();
  }
}

function toNum(v: unknown): number {
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v) || 0;
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import:

```typescript
import { guardSchema, guard } from './tools/guard.js';
```

Add tool registration:

```typescript
server.tool('knowledge_guard', 'Pre-flight check before building. Returns all design rules, platform rules, and business rules that apply to the work you are about to do. Call this before writing code.', guardSchema.shape, async (args) => {
  const result = await guard(guardSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/guard.test.ts`

Expected: All 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/guard.ts src/server.ts tests/guard.test.ts
git commit -m "feat: add knowledge_guard tool — pre-flight rule check before building"
```

---

## Task 4: `knowledge_review` Tool

**Files:**
- Create: `src/tools/review.ts`
- Create: `tests/review.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/review.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { review } from '../dist/tools/review.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_review (integration)', () => {
  let createdIds: string[] = [];

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    const r1 = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Needs copy button',
      products: ['review-test-app'],
      platforms: ['ios'],
      rules: [
        { title: 'Review test: copy button on responses', type: 'design', severity: 'must', scope: 'feature', patterns: ['chat-ui'] },
      ],
    }, testRepo);
    createdIds.push(r1.feedback_id, ...r1.rule_ids);

    const session = getSession();
    for (const id of createdIds) {
      await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-review'", { id });
    }
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-review' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('returns applicable rules for review', async () => {
    const result = await review({
      description: 'Added new chat response component',
      products: ['review-test-app'],
      platforms: ['ios'],
      files_changed: ['src/components/ChatResponse.tsx'],
    }, testRepo);

    assert.ok(result.applicable_rules.length >= 1, 'Should find applicable rules');
    assert.ok(result.applicable_rules.some((r: any) => r.title.includes('copy button')), 'Should include copy button rule');
    assert.strictEqual(typeof result.total_applicable, 'number');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/review.test.ts 2>&1 | head -10`

Expected: FAIL — module `../dist/tools/review.js` not found.

- [ ] **Step 3: Implement `src/tools/review.ts`**

```typescript
import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const reviewSchema = z.object({
  description: z.string().describe('What changed in this PR or diff'),
  products: z.array(z.string()).optional(),
  platforms: z.array(z.string()).optional(),
  files_changed: z.array(z.string()).optional(),
});

export type ReviewInput = z.infer<typeof reviewSchema>;

interface ReviewRule {
  type: string;
  id: string;
  title: string;
  severity: string;
  enforcement: string;
  source_name: string;
  repeat_count: number;
}

interface ReviewResult {
  applicable_rules: ReviewRule[];
  total_applicable: number;
  ci_gates: ReviewRule[];
}

export async function review(input: ReviewInput, _repo: RepoInfo | null): Promise<ReviewResult> {
  const session = getSession();

  try {
    const inputProducts = input.products ?? [];
    const inputPlatforms = input.platforms ?? ['all'];

    const cypher = `
      MATCH (n)
      WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
      AND COALESCE(n.status, 'active') = 'active'
      AND (
        n.scope = 'global'
        OR (
          $hasProducts = false
          OR EXISTS {
            MATCH (n)-[:APPLIES_TO]->(p:Product)
            WHERE p.name IN $products
          }
        )
      )
      AND (
        $hasPlatforms = false
        OR ANY(plat IN COALESCE(n.platforms, []) WHERE plat IN $platforms OR plat = 'all')
        OR 'all' IN $platforms
      )
      RETURN [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule','Rule']][0] AS type,
             n.id AS id,
             n.title AS title,
             COALESCE(n.severity, 'should') AS severity,
             COALESCE(n.enforcement, 'automated') AS enforcement,
             COALESCE(n.source_name, '') AS source_name,
             COALESCE(n.repeat_count, 1) AS repeat_count
      ORDER BY CASE n.enforcement WHEN 'ci-gate' THEN 0 WHEN 'automated' THEN 1 ELSE 2 END ASC,
               n.repeat_count DESC
    `;

    const result = await session.run(cypher, {
      products: inputProducts,
      platforms: inputPlatforms,
      hasProducts: inputProducts.length > 0,
      hasPlatforms: inputPlatforms.length > 0,
    });

    const rules: ReviewRule[] = result.records.map((rec) => ({
      type: rec.get('type') as string,
      id: rec.get('id') as string,
      title: rec.get('title') as string,
      severity: rec.get('severity') as string,
      enforcement: rec.get('enforcement') as string,
      source_name: rec.get('source_name') as string,
      repeat_count: toNum(rec.get('repeat_count')),
    }));

    const ciGates = rules.filter((r) => r.enforcement === 'ci-gate');

    return {
      applicable_rules: rules,
      total_applicable: rules.length,
      ci_gates: ciGates,
    };
  } finally {
    await session.close();
  }
}

function toNum(v: unknown): number {
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v) || 0;
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import:

```typescript
import { reviewSchema, review } from './tools/review.js';
```

Add tool registration:

```typescript
server.tool('knowledge_review', 'Review a diff or PR against the knowledge graph. Returns all rules that apply to the changes, highlighting CI gates and must-follow rules. Use in PR review or CI pipelines.', reviewSchema.shape, async (args) => {
  const result = await review(reviewSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/review.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/review.ts src/server.ts tests/review.test.ts
git commit -m "feat: add knowledge_review tool — validate diffs against rule graph"
```

---

## Task 5: `knowledge_violations` Tool

**Files:**
- Create: `src/tools/violations.ts`
- Create: `tests/violations.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/violations.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { violations } from '../dist/tools/violations.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_violations (integration)', () => {
  let ruleId: string;

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    const r = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'spacing',
      products: ['violations-test-app'],
      platforms: ['all'],
      rules: [
        { title: 'Violations test: spacing rule', type: 'design', severity: 'should', scope: 'global' },
      ],
    }, testRepo);
    ruleId = r.rule_ids[0];

    const session = getSession();
    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-violations'", { id: r.feedback_id });
    await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-violations'", { id: ruleId });
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-violations' DETACH DELETE n");
    await session.run("MATCH (v:Violation) WHERE v.rule_id = $ruleId DETACH DELETE v", { ruleId });
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('records a violation and increments repeat_count', async () => {
    const result = await violations({
      action: 'record',
      rule_id: ruleId,
      repo: 'test-repo',
      product: 'violations-test-app',
      platform: 'ios',
      detected_by: 'ci',
    }, testRepo);

    assert.ok(result.violation_id, 'Should return violation ID');
    assert.ok(result.new_repeat_count >= 2, 'repeat_count should have incremented');
  });

  it('queries violations', async () => {
    const result = await violations({
      action: 'query',
      scope: 'global',
    }, testRepo);

    assert.ok(result.violations.length >= 1, 'Should have at least 1 violation');
    assert.strictEqual(typeof result.total, 'number');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/violations.test.ts 2>&1 | head -10`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/violations.ts`**

```typescript
import { z } from 'zod';
import { generateId } from '../types.js';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const violationsSchema = z.object({
  action: z.enum(['record', 'query']).describe('record a new violation or query existing ones'),
  rule_id: z.string().optional().describe('ID of the violated rule (for record)'),
  repo: z.string().optional(),
  product: z.string().optional(),
  platform: z.string().optional(),
  detected_by: z.enum(['ci', 'review', 'repeated-feedback', 'guard']).optional(),
  scope: z.enum(['repo', 'product', 'global']).optional().describe('Filter scope for query'),
});

export type ViolationsInput = z.infer<typeof violationsSchema>;

interface ViolationRecord {
  id: string;
  rule_id: string;
  rule_title: string;
  repo: string;
  product: string;
  platform: string;
  detected_by: string;
  date: string;
}

interface RecordResult {
  violation_id: string;
  new_repeat_count: number;
  escalated_to: string | null;
}

interface QueryResult {
  violations: ViolationRecord[];
  total: number;
}

export async function violations(input: ViolationsInput, repo: RepoInfo | null): Promise<RecordResult | QueryResult> {
  const session = getSession();

  try {
    if (input.action === 'record') {
      if (!input.rule_id) throw new Error('rule_id is required for recording a violation');

      const violationId = generateId();
      const date = new Date().toISOString().split('T')[0];

      // Create violation node
      await session.run(
        `CREATE (v:Violation {
          id: $id,
          rule_id: $ruleId,
          repo: $repo,
          product: $product,
          platform: $platform,
          detected_by: $detectedBy,
          resolved: false,
          date: $date
        })
        WITH v
        MATCH (n {id: $ruleId})
        CREATE (v)-[:VIOLATES]->(n)`,
        {
          id: violationId,
          ruleId: input.rule_id,
          repo: input.repo ?? repo?.name ?? '',
          product: input.product ?? '',
          platform: input.platform ?? '',
          detectedBy: input.detected_by ?? 'review',
          date,
        }
      );

      // Increment repeat_count and update last_violated on the rule
      const updateResult = await session.run(
        `MATCH (n {id: $ruleId})
         SET n.repeat_count = COALESCE(n.repeat_count, 1) + 1,
             n.last_violated = $date
         RETURN n.repeat_count AS repeat_count`,
        { ruleId: input.rule_id, date }
      );

      const repeatCount = toNum(updateResult.records[0]?.get('repeat_count'));

      // Auto-escalate
      let escalatedTo: string | null = null;
      if (repeatCount >= 3) {
        await session.run(
          `MATCH (n {id: $ruleId}) SET n.enforcement = 'ci-gate', n.severity = 'must'`,
          { ruleId: input.rule_id }
        );
        escalatedTo = 'ci-gate';
      } else if (repeatCount >= 2) {
        await session.run(
          `MATCH (n {id: $ruleId}) SET n.severity = 'must'`,
          { ruleId: input.rule_id }
        );
        escalatedTo = 'must';
      }

      return {
        violation_id: violationId,
        new_repeat_count: repeatCount,
        escalated_to: escalatedTo,
      };
    } else {
      // Query violations
      let scopeFilter = '';
      const params: Record<string, string> = {};

      if (input.scope === 'repo' && (input.repo || repo)) {
        scopeFilter = 'WHERE v.repo = $repo';
        params.repo = input.repo ?? repo?.name ?? '';
      } else if (input.scope === 'product' && input.product) {
        scopeFilter = 'WHERE v.product = $product';
        params.product = input.product;
      }

      const result = await session.run(
        `MATCH (v:Violation)-[:VIOLATES]->(n)
         ${scopeFilter}
         RETURN v.id AS id, v.rule_id AS rule_id, n.title AS rule_title,
                v.repo AS repo, v.product AS product, v.platform AS platform,
                v.detected_by AS detected_by, v.date AS date
         ORDER BY v.date DESC
         LIMIT 50`,
        params
      );

      const violationList: ViolationRecord[] = result.records.map((rec) => ({
        id: rec.get('id') as string,
        rule_id: rec.get('rule_id') as string,
        rule_title: rec.get('rule_title') as string,
        repo: rec.get('repo') as string,
        product: rec.get('product') as string,
        platform: rec.get('platform') as string,
        detected_by: rec.get('detected_by') as string,
        date: rec.get('date') as string,
      }));

      return {
        violations: violationList,
        total: violationList.length,
      };
    }
  } finally {
    await session.close();
  }
}

function toNum(v: unknown): number {
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v) || 0;
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import:

```typescript
import { violationsSchema, violations } from './tools/violations.js';
```

Add tool registration:

```typescript
server.tool('knowledge_violations', 'Record or query rule violations. Recording increments repeat_count and auto-escalates enforcement. Use action=record after detecting a violation, action=query to see violation history.', violationsSchema.shape, async (args) => {
  const result = await violations(violationsSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/violations.test.ts`

Expected: All 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/violations.ts src/server.ts tests/violations.test.ts
git commit -m "feat: add knowledge_violations tool — record violations, auto-escalate enforcement"
```

---

## Task 6: `knowledge_trace` Tool

**Files:**
- Create: `src/tools/trace.ts`
- Create: `tests/trace.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/trace.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { trace } from '../dist/tools/trace.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_trace (integration)', () => {
  let ruleId: string;

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    const r = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Add copy button on responses',
      products: ['trace-test-app'],
      platforms: ['ios'],
      rules: [
        { title: 'Trace test: copy button required', type: 'design', severity: 'must', scope: 'feature', patterns: ['chat-ui'] },
      ],
    }, testRepo);
    ruleId = r.rule_ids[0];

    const session = getSession();
    await session.run("MATCH (f:Feedback {id: $id}) SET f.createdBy = 'test-trace'", { id: r.feedback_id });
    await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-trace'", { id: ruleId });
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-trace' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('traces rule origin and feedback history', async () => {
    const result = await trace({ rule_id: ruleId }, testRepo);

    assert.ok(result.rule, 'Should return rule details');
    assert.strictEqual(result.rule.title, 'Trace test: copy button required');
    assert.ok(result.origin.length >= 1, 'Should have at least 1 feedback origin');
    assert.strictEqual(result.origin[0].source_name, 'Test Founder');
    assert.strictEqual(typeof result.violation_count, 'number');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/trace.test.ts 2>&1 | head -10`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/trace.ts`**

```typescript
import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const traceSchema = z.object({
  rule_id: z.string().describe('ID of the rule to trace'),
});

export type TraceInput = z.infer<typeof traceSchema>;

interface TraceOrigin {
  feedback_id: string;
  source_name: string;
  source_role: string;
  raw_text: string;
  date: string;
}

interface TraceRule {
  id: string;
  title: string;
  type: string;
  severity: string;
  scope: string;
  platforms: string[];
  patterns: string[];
  enforcement: string;
  repeat_count: number;
  last_violated: string | null;
  date: string;
}

interface TraceResult {
  rule: TraceRule;
  origin: TraceOrigin[];
  violation_count: number;
  violations: Array<{ date: string; repo: string; detected_by: string }>;
  products: string[];
}

export async function trace(input: TraceInput, _repo: RepoInfo | null): Promise<TraceResult> {
  const session = getSession();

  try {
    // Get rule details
    const ruleResult = await session.run(
      `MATCH (n {id: $id})
       WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
       OPTIONAL MATCH (n)-[:APPLIES_TO]->(p:Product)
       WITH n, collect(DISTINCT p.name) AS products,
            [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule','Rule']][0] AS type
       RETURN type, n.id AS id, n.title AS title,
              COALESCE(n.severity, 'should') AS severity,
              COALESCE(n.scope, 'product') AS scope,
              COALESCE(n.platforms, []) AS platforms,
              COALESCE(n.patterns, []) AS patterns,
              COALESCE(n.enforcement, 'automated') AS enforcement,
              COALESCE(n.repeat_count, 1) AS repeat_count,
              n.last_violated AS last_violated,
              n.date AS date,
              products`,
      { id: input.rule_id }
    );

    if (ruleResult.records.length === 0) {
      throw new Error(`Rule not found: ${input.rule_id}`);
    }

    const rec = ruleResult.records[0];
    const ruleData: TraceRule = {
      id: rec.get('id') as string,
      title: rec.get('title') as string,
      type: rec.get('type') as string,
      severity: rec.get('severity') as string,
      scope: rec.get('scope') as string,
      platforms: rec.get('platforms') as string[],
      patterns: rec.get('patterns') as string[],
      enforcement: rec.get('enforcement') as string,
      repeat_count: toNum(rec.get('repeat_count')),
      last_violated: rec.get('last_violated') as string | null,
      date: rec.get('date') as string,
    };
    const products = rec.get('products') as string[];

    // Get feedback origins
    const originResult = await session.run(
      `MATCH (f:Feedback)-[:GENERATED]->(n {id: $id})
       RETURN f.id AS feedback_id, f.source_name AS source_name,
              f.source_role AS source_role, f.raw_text AS raw_text, f.date AS date
       ORDER BY f.date ASC`,
      { id: input.rule_id }
    );

    const origin: TraceOrigin[] = originResult.records.map((r) => ({
      feedback_id: r.get('feedback_id') as string,
      source_name: r.get('source_name') as string,
      source_role: r.get('source_role') as string,
      raw_text: r.get('raw_text') as string,
      date: r.get('date') as string,
    }));

    // Get violations
    const violationResult = await session.run(
      `MATCH (v:Violation)-[:VIOLATES]->(n {id: $id})
       RETURN v.date AS date, v.repo AS repo, v.detected_by AS detected_by
       ORDER BY v.date DESC`,
      { id: input.rule_id }
    );

    const violationList = violationResult.records.map((r) => ({
      date: r.get('date') as string,
      repo: r.get('repo') as string,
      detected_by: r.get('detected_by') as string,
    }));

    return {
      rule: ruleData,
      origin,
      violation_count: violationList.length,
      violations: violationList,
      products,
    };
  } finally {
    await session.close();
  }
}

function toNum(v: unknown): number {
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v) || 0;
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import:

```typescript
import { traceSchema, trace } from './tools/trace.js';
```

Add tool registration:

```typescript
server.tool('knowledge_trace', 'Trace a rule back to its origin. Shows who created it, how many times it has been repeated, and its violation history. Use when an engineer questions why a rule exists.', traceSchema.shape, async (args) => {
  const result = await trace(traceSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/trace.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/trace.ts src/server.ts tests/trace.test.ts
git commit -m "feat: add knowledge_trace tool — trace rules to origin feedback"
```

---

## Task 7: `knowledge_impact` Tool

**Files:**
- Create: `src/tools/impact.ts`
- Create: `tests/impact.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/impact.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { relate } from '../dist/tools/relate.js';
import { impact } from '../dist/tools/impact.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_impact (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    // Create product relationships
    await relate({ from: 'impact-web', to: 'impact-api', relationship: 'consumes', detail: 'web consumes api' });
    await relate({ from: 'impact-ios', to: 'impact-api', relationship: 'consumes', detail: 'ios consumes api' });
    await relate({ from: 'impact-android', to: 'impact-api', relationship: 'consumes', detail: 'android consumes api' });
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (p:Product) WHERE p.name STARTS WITH 'impact-' DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('finds cascade-affected products through shared dependencies', async () => {
    const result = await impact({
      change: 'Modifying response generation logic',
      product: 'impact-api',
    }, testRepo);

    assert.ok(result.directly_affected, 'Should have directly_affected');
    assert.ok(result.connected_products.length >= 2, 'Should find at least 2 connected products (web, ios, or android)');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/impact.test.ts 2>&1 | head -10`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/impact.ts`**

```typescript
import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const impactSchema = z.object({
  change: z.string().describe('Description of the change being made'),
  product: z.string().describe('Product being changed'),
  platform: z.string().optional(),
});

export type ImpactInput = z.infer<typeof impactSchema>;

interface ConnectedProduct {
  name: string;
  relationship: string;
  detail: string | null;
}

interface AtRiskRule {
  id: string;
  title: string;
  severity: string;
  repeat_count: number;
}

interface ImpactResult {
  directly_affected: string;
  connected_products: ConnectedProduct[];
  rules_at_risk: AtRiskRule[];
}

export async function impact(input: ImpactInput, _repo: RepoInfo | null): Promise<ImpactResult> {
  const session = getSession();

  try {
    // Find products connected to this product via any relationship direction
    const connResult = await session.run(
      `MATCH (source:Product {name: $product})
       OPTIONAL MATCH (source)-[r1:RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->(target:Product)
       WITH source, collect({name: target.name, relationship: r1.relationship, detail: r1.detail}) AS outgoing
       OPTIONAL MATCH (other:Product)-[r2:RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->(source)
       WITH source, outgoing, collect({name: other.name, relationship: r2.relationship, detail: r2.detail}) AS incoming
       RETURN outgoing, incoming`,
      { product: input.product }
    );

    const connected: ConnectedProduct[] = [];
    if (connResult.records.length > 0) {
      const rec = connResult.records[0];
      const outgoing = rec.get('outgoing') as any[];
      const incoming = rec.get('incoming') as any[];

      for (const o of outgoing) {
        if (o.name) connected.push({ name: o.name, relationship: o.relationship ?? 'relates_to', detail: o.detail });
      }
      for (const i of incoming) {
        if (i.name) connected.push({ name: i.name, relationship: i.relationship ?? 'relates_to', detail: i.detail });
      }
    }

    // Find rules that apply to the changed product or any connected product
    const allProductNames = [input.product, ...connected.map((c) => c.name)];
    const rulesResult = await session.run(
      `MATCH (n)-[:APPLIES_TO]->(p:Product)
       WHERE p.name IN $products
       AND ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
       AND COALESCE(n.status, 'active') = 'active'
       RETURN n.id AS id, n.title AS title,
              COALESCE(n.severity, 'should') AS severity,
              COALESCE(n.repeat_count, 1) AS repeat_count
       ORDER BY n.repeat_count DESC`,
      { products: allProductNames }
    );

    const rulesAtRisk: AtRiskRule[] = rulesResult.records.map((rec) => ({
      id: rec.get('id') as string,
      title: rec.get('title') as string,
      severity: rec.get('severity') as string,
      repeat_count: toNum(rec.get('repeat_count')),
    }));

    return {
      directly_affected: input.product,
      connected_products: connected,
      rules_at_risk: rulesAtRisk,
    };
  } finally {
    await session.close();
  }
}

function toNum(v: unknown): number {
  if (v !== null && typeof v === 'object' && 'toNumber' in v) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v) || 0;
}
```

- [ ] **Step 4: Register tool in `src/server.ts`**

Add import:

```typescript
import { impactSchema, impact } from './tools/impact.js';
```

Add tool registration:

```typescript
server.tool('knowledge_impact', 'Cross-product impact analysis. Given a change in one product, shows connected products, shared dependencies, and rules at risk. Use before making changes that could affect multiple products.', impactSchema.shape, async (args) => {
  const result = await impact(impactSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/impact.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/impact.ts src/server.ts tests/impact.test.ts
git commit -m "feat: add knowledge_impact tool — cross-product cascade analysis"
```

---

## Task 8: Upgrade `knowledge_status` to `knowledge_health`

**Files:**
- Modify: `src/tools/status.ts`
- Create: `tests/health.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the failing test in `tests/health.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { status } from '../dist/tools/status.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge_health (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();
  });

  after(async () => {
    await closeDriver();
  });

  it('returns compliance metrics alongside existing counts', async () => {
    const s = await status({ scope: 'global' }, testRepo);

    // Existing fields still work
    assert.strictEqual(typeof s.counts.decisions, 'number');
    assert.strictEqual(typeof s.counts.constraints, 'number');
    assert.strictEqual(typeof s.counts.rules, 'number');

    // New compliance fields
    assert.ok('compliance' in s, 'Should have compliance field');
    assert.strictEqual(typeof s.compliance.total_rules, 'number');
    assert.strictEqual(typeof s.compliance.violated_this_month, 'number');
    assert.ok(Array.isArray(s.top_violations), 'Should have top_violations array');
    assert.ok('founder_repeat_feedback' in s, 'Should have founder_repeat_feedback');
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/health.test.ts 2>&1 | head -20`

Expected: FAIL — `compliance` property not found.

- [ ] **Step 3: Update `src/tools/status.ts` to add compliance metrics**

Add these fields to the `StatusResult` interface:

```typescript
interface StatusResult {
  repo: string | null;
  scope: string;
  counts: {
    decisions: number;
    constraints: number;
    rules: number;
    products: number;
    relationships: number;
  };
  recent: Array<{ type: string; title: string; date: string }>;
  compliance: {
    total_rules: number;
    violated_this_month: number;
  };
  top_violations: Array<{
    rule_title: string;
    violation_count: number;
    last_violated: string | null;
    source_name: string;
  }>;
  founder_repeat_feedback: {
    total: number;
    still_recurring: number;
  };
}
```

Add these queries **before the `return` statement** in the `status` function, after the `recent` query:

```typescript
    // Count all design/platform rules
    const allRulesResult = await session.run(
      `MATCH (n) WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule'])
       AND COALESCE(n.status, 'active') = 'active'
       RETURN count(n) AS cnt`
    );
    const totalRules = toNum(allRulesResult.records[0]?.get('cnt'));

    // Count violations this month
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    const violatedResult = await session.run(
      `MATCH (v:Violation) WHERE v.date >= $monthStart RETURN count(v) AS cnt`,
      { monthStart: monthStartStr }
    );
    const violatedThisMonth = toNum(violatedResult.records[0]?.get('cnt'));

    // Top violated rules
    const topViolationsResult = await session.run(
      `MATCH (v:Violation)-[:VIOLATES]->(n)
       WITH n, count(v) AS vcount, max(v.date) AS lastDate
       RETURN n.title AS rule_title, vcount AS violation_count,
              lastDate AS last_violated,
              COALESCE(n.source_name, '') AS source_name
       ORDER BY vcount DESC
       LIMIT 5`
    );
    const topViolations = topViolationsResult.records.map((rec) => ({
      rule_title: rec.get('rule_title') as string,
      violation_count: toNum(rec.get('violation_count')),
      last_violated: rec.get('last_violated') as string | null,
      source_name: rec.get('source_name') as string,
    }));

    // Founder repeat feedback
    const founderResult = await session.run(
      `MATCH (n)
       WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
       AND COALESCE(n.source_role, '') = 'founder'
       RETURN count(n) AS total,
              count(CASE WHEN COALESCE(n.repeat_count, 1) >= 2 THEN 1 END) AS recurring`
    );
    const founderTotal = toNum(founderResult.records[0]?.get('total'));
    const founderRecurring = toNum(founderResult.records[0]?.get('recurring'));
```

Update the return statement to include:

```typescript
    return {
      repo: repo?.name ?? null,
      scope: input.scope,
      counts: { decisions, constraints, rules, products, relationships },
      recent,
      compliance: {
        total_rules: totalRules,
        violated_this_month: violatedThisMonth,
      },
      top_violations: topViolations,
      founder_repeat_feedback: {
        total: founderTotal,
        still_recurring: founderRecurring,
      },
    };
```

- [ ] **Step 4: Rename tool in `src/server.ts`**

Change the existing `knowledge_status` registration to:

```typescript
server.tool('knowledge_health', 'Health dashboard for the knowledge graph. Shows counts, recent entries, compliance metrics, top violations, and founder repeat feedback. Upgraded from knowledge_status.', statusSchema.shape, async (args) => {
  const result = await status(statusSchema.parse(args), repo);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && node --test tests/health.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Also run existing status test to confirm backward compatibility**

Run: `npm run build && node --test tests/tools.test.ts`

Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/tools/status.ts src/server.ts tests/health.test.ts
git commit -m "feat: upgrade knowledge_status to knowledge_health with compliance metrics"
```

---

## Task 9: Smart Session Injection

**Files:**
- Modify: `bin/session-start.js`
- Create: `tests/session-start.test.ts`

- [ ] **Step 1: Write the failing test in `tests/session-start.test.ts`**

```typescript
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { execSync } from 'child_process';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('session-start smart injection (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running');
    await initSchema();

    // Seed some data: a repeated design rule
    const r1 = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Fix spacing',
      products: ['session-test-app'],
      platforms: ['all'],
      rules: [
        { title: 'Session test: 8px spacing', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    // Second ingest to make it repeated
    await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'Spacing again',
      products: ['session-test-app'],
      platforms: ['all'],
      rules: [
        { title: 'Session test: 8px spacing', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    const session = getSession();
    await session.run("MATCH (f:Feedback) WHERE f.raw_text CONTAINS 'spacing' OR f.raw_text CONTAINS 'Spacing' SET f.createdBy = 'test-session'");
    for (const id of r1.rule_ids) {
      await session.run("MATCH (n {id: $id}) SET n.createdBy = 'test-session'", { id });
    }
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test-session' DETACH DELETE n");
    await session.run("MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p");
    await session.close();
    await closeDriver();
  });

  it('outputs repeated feedback section', () => {
    const output = execSync('node bin/session-start.js', { encoding: 'utf-8', timeout: 10000 });
    // Should contain the repeated feedback section header
    assert.ok(
      output.includes('REPEATED FEEDBACK') || output.includes('Known Constraints') || output.includes('Design Rules'),
      'Should output structured knowledge sections'
    );
  });
});
```

- [ ] **Step 2: Build and run test to verify it fails**

Run: `npm run build && node --test tests/session-start.test.ts 2>&1 | head -20`

Expected: FAIL — output doesn't include "REPEATED FEEDBACK" section.

- [ ] **Step 3: Rewrite `bin/session-start.js` with smart injection**

```javascript
#!/usr/bin/env node
/**
 * SessionStart hook — queries the knowledge graph for entries relevant to this repo
 * and outputs them as context for the AI agent.
 *
 * Priority ordering:
 * 1. REPEATED FEEDBACK (repeat_count >= 2) — founder said this 2+ times
 * 2. MUST design/platform rules for this product + platform
 * 3. Global design rules
 * 4. Active constraints
 * 5. Recent decisions
 *
 * Output goes to stdout → injected into conversation context.
 */
const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'knowledge-graph-local';

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

    let output = '';

    // 1. REPEATED FEEDBACK — rules with repeat_count >= 2
    const repeatedResult = await session.run(`
      MATCH (n)
      WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule', 'Rule'])
      AND COALESCE(n.status, 'active') = 'active'
      AND COALESCE(n.repeat_count, 1) >= 2
      RETURN n.title AS title, n.repeat_count AS repeat_count,
             n.last_violated AS last_violated, n.source_name AS source,
             [l IN labels(n) WHERE l IN ['DesignRule','PlatformRule','Rule']][0] AS type
      ORDER BY n.repeat_count DESC
      LIMIT 10
    `);

    if (repeatedResult.records.length > 0) {
      output += `## REPEATED FEEDBACK (said 2+ times — do not miss these)\n`;
      for (const rec of repeatedResult.records) {
        const title = rec.get('title');
        const count = typeof rec.get('repeat_count') === 'object'
          ? rec.get('repeat_count').toNumber() : Number(rec.get('repeat_count'));
        const source = rec.get('source') || 'unknown';
        const lastViolated = rec.get('last_violated');
        output += `- ${title} [${count}x, source: ${source}${lastViolated ? ', last violated: ' + lastViolated : ''}]\n`;
      }
      output += '\n';
    }

    // 2. DESIGN RULES — must severity, active
    const designResult = await session.run(`
      MATCH (n)
      WHERE ANY(label IN labels(n) WHERE label IN ['DesignRule', 'PlatformRule'])
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

    // 3. CONSTRAINTS — existing behavior preserved
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

    // 4. DECISIONS — existing behavior preserved
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

    // 5. BUSINESS RULES — existing behavior preserved
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
        output += `- [${domain}] ${title}${productTag}\n`;
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
```

- [ ] **Step 4: Run test**

Run: `node --test tests/session-start.test.ts`

Expected: Test passes — output includes structured sections.

- [ ] **Step 5: Commit**

```bash
git add bin/session-start.js tests/session-start.test.ts
git commit -m "feat: smart session injection — priority-ordered with repeated feedback first"
```

---

## Task 10: Version Bump & Final Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version in `package.json`**

Change `"version": "0.1.3"` to `"version": "0.2.0"`.

- [ ] **Step 2: Build everything**

Run: `npm run build`

Expected: Clean compilation, no errors.

- [ ] **Step 3: Run all tests**

Run: `npm run build && node --test tests/tools.test.ts tests/ingest.test.ts tests/guard.test.ts tests/review.test.ts tests/violations.test.ts tests/trace.test.ts tests/impact.test.ts tests/health.test.ts tests/session-start.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Verify the MCP server starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | timeout 5 node dist/index.js 2>/dev/null || true`

Expected: JSON response with server capabilities listing all 13 tools.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.2.0 — active knowledge enforcer"
```
