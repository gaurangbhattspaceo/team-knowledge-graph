import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { decide } from '../dist/tools/decide.js';
import { constraint } from '../dist/tools/constraint.js';
import { rule } from '../dist/tools/rule.js';
import { query } from '../dist/tools/query.js';
import { relate } from '../dist/tools/relate.js';
import { status } from '../dist/tools/status.js';

const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };

describe('knowledge tools (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();
    // Clean test data
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test' DETACH DELETE n");
    await session.close();
  });

  after(async () => {
    const session = getSession();
    await session.run("MATCH (n) WHERE n.createdBy = 'test' DETACH DELETE n");
    await session.close();
    await closeDriver();
  });

  it('stores and queries a decision', async () => {
    const d = await decide({
      title: 'Test decision for integration',
      reasoning: 'For testing purposes',
      products: ['test-product'],
      technologies: ['testlib@1.0.0'],
    }, testRepo);
    assert.ok(d.id);
    assert.ok(d.stored);

    // Tag for cleanup
    const session = getSession();
    await session.run("MATCH (d:Decision {id: $id}) SET d.createdBy = 'test'", { id: d.id });
    await session.close();

    const q = await query({ query: 'Test decision integration', type: 'all', limit: 5 }, testRepo);
    assert.ok(q.results.length > 0, 'Should find the decision');
    const found = q.results.find((r: any) => r.id === d.id);
    assert.ok(found, 'Should find by ID');
  });

  it('stores a constraint', async () => {
    const c = await constraint({
      title: 'Test constraint for integration',
      detail: 'Something does not work',
      severity: 'warning' as const,
      products: ['test-product'],
    }, testRepo);
    assert.ok(c.id);
    assert.ok(c.stored);

    const session = getSession();
    await session.run("MATCH (c:Constraint {id: $id}) SET c.createdBy = 'test'", { id: c.id });
    await session.close();
  });

  it('stores a rule', async () => {
    const r = await rule({
      title: 'Test rule for integration',
      detail: 'A business rule',
      domain: 'testing',
      products: ['test-product'],
    }, testRepo);
    assert.ok(r.id);
    assert.ok(r.stored);

    const session = getSession();
    await session.run("MATCH (r:Rule {id: $id}) SET r.createdBy = 'test'", { id: r.id });
    await session.close();
  });

  it('records a product relationship', async () => {
    const result = await relate({
      from: 'test-product',
      to: 'other-test-product',
      relationship: 'calls via API',
    });
    assert.ok(result.stored);
  });

  it('returns status with counts', async () => {
    const s = await status({ scope: 'global' }, testRepo);
    assert.ok(s.counts.decisions >= 1, 'Should have at least 1 decision');
    assert.ok(s.counts.constraints >= 1, 'Should have at least 1 constraint');
    assert.ok(s.counts.rules >= 1, 'Should have at least 1 rule');
    assert.ok(s.counts.products >= 1, 'Should have at least 1 product');
  });
});
