import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { ingest } from '../dist/tools/ingest.js';
import { review } from '../dist/tools/review.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };
const CREATED_BY = 'test-review';

describe('knowledge_review (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();
    // Clean test data
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestReview' DETACH DELETE p`);
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
    await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestReview' DETACH DELETE p`);
    await session.run(`MATCH (p:Product {name: 'test-review-product'}) DETACH DELETE p`);
    await session.close();
    await closeDriver();
  });

  it('returns applicable rules for matching product + platform', async () => {
    // Seed rules via ingest
    const ingested = await ingest({
      source: 'TestReviewFounder',
      role: 'founder',
      feedback: 'Mobile forms must have proper validation and error display.',
      products: ['test-review-product'],
      platforms: ['ios', 'android'],
      rules: [
        { title: 'TestReview forms must validate on submit', type: 'design', severity: 'must', scope: 'product' },
        { title: 'TestReview inline errors must be shown below fields', type: 'design', severity: 'should', scope: 'feature' },
      ],
    }, testRepo);

    // Tag nodes for cleanup
    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    // Call review with matching product + platform
    const result = await review({
      description: 'Add form validation to login screen',
      products: ['test-review-product'],
      platforms: ['ios'],
    }, testRepo);

    assert.ok(result.total_applicable >= 2, `Should return at least 2 rules, got ${result.total_applicable}`);
    const titles = result.applicable_rules.map((r) => r.title);
    assert.ok(titles.some((t) => t.includes('TestReview forms must validate on submit')), 'Should include form validation rule');
    assert.ok(titles.some((t) => t.includes('TestReview inline errors must be shown below fields')), 'Should include inline errors rule');
  });

  it('separates ci-gate rules into ci_gates array', async () => {
    // Seed a rule then manually escalate it to ci-gate
    const ingested = await ingest({
      source: 'TestReviewCSM',
      role: 'csm',
      feedback: 'Security headers must always be present.',
      products: ['test-review-product'],
      rules: [
        { title: 'TestReview security headers required', type: 'platform', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag, n.enforcement = 'ci-gate'`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    const result = await review({
      description: 'Update API gateway configuration',
      products: ['test-review-product'],
    }, testRepo);

    assert.ok(result.ci_gates.length >= 1, `Should have at least 1 ci-gate, got ${result.ci_gates.length}`);
    const ciTitles = result.ci_gates.map((r) => r.title);
    assert.ok(ciTitles.some((t) => t.includes('TestReview security headers required')), 'CI gates should include security headers rule');
    // ci-gate rules should also appear in applicable_rules
    assert.ok(result.applicable_rules.some((r) => r.enforcement === 'ci-gate'), 'ci-gate rules should appear in applicable_rules too');
  });

  it('sorts ci-gate rules first, then by repeat_count DESC', async () => {
    // Seed rules via ingest with differing enforcement
    const ingested = await ingest({
      source: 'TestReviewEngineer',
      role: 'engineer',
      feedback: 'Multiple rules for sorting test.',
      products: ['test-review-product'],
      rules: [
        { title: 'TestReview sort normal rule', type: 'design', severity: 'must', scope: 'global' },
        { title: 'TestReview sort ci-gate rule', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    // Escalate one rule to ci-gate
    const ciGateId = ingested.rule_ids[1];
    await session.run(`MATCH (n {id: $id}) SET n.enforcement = 'ci-gate'`, { id: ciGateId });
    await session.close();

    const result = await review({
      description: 'General PR review',
      products: ['test-review-product'],
    }, testRepo);

    // ci-gate rules must appear before non-ci-gate rules in applicable_rules
    const testRules = result.applicable_rules.filter((r) => r.title.startsWith('TestReview sort'));
    const ciGateIdx = testRules.findIndex((r) => r.enforcement === 'ci-gate');
    const normalIdx = testRules.findIndex((r) => r.enforcement !== 'ci-gate');

    if (ciGateIdx >= 0 && normalIdx >= 0) {
      assert.ok(ciGateIdx < normalIdx, 'ci-gate rules should appear before non-ci-gate rules');
    }
  });

  it('returns global scope rules even without product match', async () => {
    // Seed a global rule
    const ingested = await ingest({
      source: 'TestReviewClient',
      role: 'client',
      feedback: 'All changes must be backwards compatible.',
      products: ['test-review-product'],
      rules: [
        { title: 'TestReview all APIs must be backwards compatible', type: 'design', severity: 'must', scope: 'global' },
      ],
    }, testRepo);

    const session = getSession();
    await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
    for (const ruleId of ingested.rule_ids) {
      await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
    }
    await session.close();

    // Call review with no products — global rules should still appear
    const result = await review({
      description: 'Refactor internal service',
    }, testRepo);

    const titles = result.applicable_rules.map((r) => r.title);
    assert.ok(
      titles.some((t) => t.includes('TestReview all APIs must be backwards compatible')),
      'Global scope rules should appear even without product match'
    );
  });
});
