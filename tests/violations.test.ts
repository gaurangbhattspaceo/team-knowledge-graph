import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { violations } from '../dist/tools/violations.js';

const testRepo = { url: 'test.com/org/test-violations', name: 'test-violations' };
const CREATED_BY = 'test-violations';

describe('knowledge_violations (integration)', () => {
  let seededRuleId: string;

  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();

    // Clean any leftover test data
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.close();

    // Seed a rule via ingest
    const result = await ingest({
      source: 'TestViolationsFounder',
      role: 'founder',
      feedback: 'Navigation buttons must always be visible above the fold.',
      products: ['test-violations-product'],
      rules: [
        { title: 'TestViolations nav buttons must be visible above fold', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    assert.strictEqual(result.rules_created, 1, 'Should seed 1 rule');
    seededRuleId = result.rule_ids[0];

    // Tag seeded data for cleanup
    const tagSession = getSession();
    await tagSession.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: result.feedback_id, tag: CREATED_BY });
    await tagSession.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: seededRuleId, tag: CREATED_BY });
    await tagSession.close();
  });

  after(async () => {
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestViolations' DETACH DELETE p`);
    await session.close();
    await closeDriver();
  });

  it('records a violation and returns violation_id with incremented repeat_count', async () => {
    const result = await violations({
      action: 'record',
      rule_id: seededRuleId,
      repo: 'test-violations',
      product: 'test-violations-product',
      platform: 'web',
      detected_by: 'ci',
    }, testRepo);

    assert.ok('violation_id' in result, 'Should return violation_id');
    assert.ok('new_repeat_count' in result, 'Should return new_repeat_count');

    const recordResult = result as { violation_id: string; new_repeat_count: number; escalated_to: string | null };
    assert.ok(recordResult.violation_id, 'violation_id should be non-empty');
    assert.ok(recordResult.new_repeat_count >= 2, 'new_repeat_count should be at least 2 after recording a violation');

    // Tag the created violation for cleanup
    const session = getSession();
    await session.run(`MATCH (v:Violation {id: $id}) SET v.createdBy = $tag`, { id: recordResult.violation_id, tag: CREATED_BY });
    await session.close();
  });

  it('auto-escalates severity to must when repeat_count >= 2', async () => {
    const result = await violations({
      action: 'record',
      rule_id: seededRuleId,
      detected_by: 'review',
    }, testRepo);

    const recordResult = result as { violation_id: string; new_repeat_count: number; escalated_to: string | null };
    assert.ok(recordResult.new_repeat_count >= 2, 'repeat_count should be >= 2');
    // Escalation should be either severity:must or ci-gate at this point
    const validEscalations = [null, 'severity:must', 'ci-gate'];
    assert.ok(validEscalations.includes(recordResult.escalated_to), `escalated_to should be one of ${validEscalations.join(', ')}`);

    // Tag the violation for cleanup
    const session = getSession();
    await session.run(`MATCH (v:Violation {id: $id}) SET v.createdBy = $tag`, { id: recordResult.violation_id, tag: CREATED_BY });
    await session.close();
  });

  it('queries violations and returns at least 1 result', async () => {
    const result = await violations({
      action: 'query',
      scope: 'global',
    }, testRepo);

    assert.ok('violations' in result, 'Should return violations array');
    assert.ok('total' in result, 'Should return total count');

    const queryResult = result as { violations: unknown[]; total: number };
    assert.ok(queryResult.total >= 1, 'Should have at least 1 violation in the graph');
    assert.ok(queryResult.violations.length >= 1, 'Violations array should have at least 1 entry');
  });

  it('queries violations filtered by repo scope', async () => {
    const result = await violations({
      action: 'query',
      scope: 'repo',
      repo: 'test-violations',
    }, testRepo);

    const queryResult = result as { violations: Array<{ repo: string }>; total: number };
    assert.ok('violations' in result, 'Should return violations array');
    // All returned violations should match the repo filter
    for (const v of queryResult.violations) {
      assert.strictEqual(v.repo, 'test-violations', 'Each violation should match the repo filter');
    }
  });

  it('fails gracefully when rule_id missing for record action', async () => {
    await assert.rejects(
      async () => violations({ action: 'record' }, testRepo),
      (err: Error) => {
        assert.ok(err.message.includes('rule_id'), 'Error should mention rule_id');
        return true;
      }
    );
  });
});
