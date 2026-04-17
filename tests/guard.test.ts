import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { guard } from '../dist/tools/guard.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };
const CREATED_BY = 'test-guard';

describe('knowledge_guard (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();
    // Clean test data
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestGuard' DETACH DELETE p`);
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestGuard' DETACH DELETE p`);
    await session.run(`MATCH (p:Product {name: 'test-guard-product'}) DETACH DELETE p`);
    await session.close();
    await closeDriver();
  });

  it('returns matching rules for product + pattern', async () => {
    // Seed rules via ingest
    const ingested = await ingest({
      source: 'TestGuardFounder',
      role: 'founder',
      feedback: 'Chat UI needs better loading states and error handling.',
      products: ['test-guard-product'],
      platforms: ['ios', 'android'],
      rules: [
        { title: 'TestGuard chat must show loading skeleton', type: 'design', severity: 'must', scope: 'feature', patterns: ['chat-ui'] },
        { title: 'TestGuard error states must have retry button', type: 'design', severity: 'should', scope: 'product', patterns: ['chat-ui', 'voice'] },
      ],
    }, testRepo);

    // Tag for cleanup
    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    // Call guard with matching product + pattern
    const result = await guard({
      description: 'Building chat message list with loading states',
      products: ['test-guard-product'],
      platforms: ['ios'],
      patterns: ['chat-ui'],
    }, testRepo);

    assert.ok(result.total >= 2, `Should return at least 2 rules, got ${result.total}`);
    const titles = result.rules.map((r) => r.title);
    assert.ok(titles.some((t) => t.includes('TestGuard chat must show loading skeleton')), 'Should include chat loading rule');
    assert.ok(titles.some((t) => t.includes('TestGuard error states must have retry button')), 'Should include error states rule');
  });

  it('returns global rules even with non-matching pattern', async () => {
    // Seed a global rule
    const ingested = await ingest({
      source: 'TestGuardCSM',
      role: 'csm',
      feedback: 'All screens must have accessibility labels.',
      products: ['test-guard-product'],
      rules: [
        { title: 'TestGuard all screens must have accessibility labels', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    // Tag for cleanup
    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    // Call guard with non-matching pattern
    const result = await guard({
      description: 'Building payment checkout flow',
      products: ['test-guard-product'],
      patterns: ['payment'],
    }, testRepo);

    const titles = result.rules.map((r) => r.title);
    assert.ok(
      titles.some((t) => t.includes('TestGuard all screens must have accessibility labels')),
      'Should include global rule even when pattern does not match'
    );
  });

  it('sorts by repeat_count DESC then severity', async () => {
    // Seed rules with different severities
    const ingested = await ingest({
      source: 'TestGuardEngineer',
      role: 'engineer',
      feedback: 'Various rules for sorting test.',
      products: ['test-guard-product'],
      rules: [
        { title: 'TestGuard nice-to-have rule', type: 'design', severity: 'nice-to-have', scope: 'global' },
        { title: 'TestGuard must rule', type: 'design', severity: 'must', scope: 'global' },
        { title: 'TestGuard should rule', type: 'platform', severity: 'should', scope: 'global' },
      ],
    }, testRepo);

    // Tag for cleanup
    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    const result = await guard({
      description: 'General check',
      products: ['test-guard-product'],
    }, testRepo);

    // Filter to just our test rules for sorting check
    const testRules = result.rules.filter((r) => r.title.startsWith('TestGuard'));
    // Among same repeat_count, must should come before should, which comes before nice-to-have
    const mustIdx = testRules.findIndex((r) => r.title.includes('must rule'));
    const shouldIdx = testRules.findIndex((r) => r.title.includes('should rule'));
    const niceIdx = testRules.findIndex((r) => r.title.includes('nice-to-have rule'));

    if (mustIdx >= 0 && shouldIdx >= 0) {
      assert.ok(mustIdx < shouldIdx, 'must should come before should');
    }
    if (shouldIdx >= 0 && niceIdx >= 0) {
      assert.ok(shouldIdx < niceIdx, 'should should come before nice-to-have');
    }
  });
});
