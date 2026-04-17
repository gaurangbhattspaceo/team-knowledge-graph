import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { trace } from '../dist/tools/trace.js';

const testRepo = { url: 'test.com/org/test-trace', name: 'test-trace' };
const CREATED_BY = 'test-trace';

describe('knowledge_trace (integration)', () => {
  let seededRuleId: string;
  let seededFeedbackId: string;

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();

    // Clean any leftover test data
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestTrace' DETACH DELETE p`);
    await session.close();

    // Seed a rule via ingest with source "Test Founder"
    const result = await ingest({
      source: 'Test Founder',
      role: 'founder',
      feedback: 'All primary actions must use a consistent brand colour across every screen.',
      products: ['test-trace-product'],
      platforms: ['ios', 'android'],
      rules: [
        {
          title: 'TestTrace primary actions must use consistent brand colour',
          type: 'design',
          severity: 'must',
          scope: 'global',
          patterns: ['button-colour', 'brand-consistency'],
        },
      ],
    }, testRepo);

    assert.strictEqual(result.rules_created, 1, 'Should seed 1 rule');
    seededRuleId = result.rule_ids[0];
    seededFeedbackId = result.feedback_id;

    // Tag seeded data for cleanup
    const tagSession = getSession();
    await tagSession.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: seededFeedbackId, tag: CREATED_BY });
    await tagSession.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: seededRuleId, tag: CREATED_BY });
    await tagSession.close();
  });

  after(async () => {
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestTrace' DETACH DELETE p`);
    await session.run(`MATCH (p:Person {name: 'Test Founder'}) DETACH DELETE p`);
    await session.close();
    await closeDriver();
  });

  it('traces a rule and returns correct rule title', async () => {
    const result = await trace({ rule_id: seededRuleId }, testRepo);

    assert.ok(result.rule, 'Should return a rule object');
    assert.strictEqual(result.rule.id, seededRuleId, 'rule.id should match seeded rule');
    assert.ok(
      result.rule.title.includes('TestTrace'),
      `rule.title should include "TestTrace", got: ${result.rule.title}`
    );
    assert.ok(result.rule.type, 'rule.type should be set');
    assert.ok(['DesignRule', 'PlatformRule', 'Rule'].includes(result.rule.type), `rule.type should be a valid label, got: ${result.rule.type}`);
  });

  it('returns origin with source_name = "Test Founder"', async () => {
    const result = await trace({ rule_id: seededRuleId }, testRepo);

    assert.ok(Array.isArray(result.origin), 'origin should be an array');
    assert.ok(result.origin.length >= 1, 'Should have at least 1 origin (the seeded feedback)');

    const found = result.origin.find((o) => o.source_name === 'Test Founder');
    assert.ok(found, 'Should find origin with source_name = "Test Founder"');
    assert.ok(found.feedback_id, 'Origin should have a feedback_id');
    assert.ok(found.raw_text, 'Origin should have raw_text');
  });

  it('returns violation_count as a number', async () => {
    const result = await trace({ rule_id: seededRuleId }, testRepo);

    assert.strictEqual(typeof result.violation_count, 'number', 'violation_count should be a number');
    assert.ok(result.violation_count >= 0, 'violation_count should be non-negative');
    assert.ok(Array.isArray(result.violations), 'violations should be an array');
    assert.strictEqual(result.violations.length, result.violation_count, 'violations.length should match violation_count');
  });

  it('returns products array', async () => {
    const result = await trace({ rule_id: seededRuleId }, testRepo);

    assert.ok(Array.isArray(result.products), 'products should be an array');
    assert.ok(
      result.products.includes('test-trace-product'),
      `products should include "test-trace-product", got: ${JSON.stringify(result.products)}`
    );
  });

  it('throws an error when rule_id does not exist', async () => {
    await assert.rejects(
      async () => trace({ rule_id: 'nonexistent-rule-id-xyz' }, testRepo),
      (err: Error) => {
        assert.ok(err.message.includes('Rule not found'), `Error should mention "Rule not found", got: ${err.message}`);
        return true;
      }
    );
  });
});
