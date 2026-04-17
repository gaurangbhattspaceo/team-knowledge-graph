import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { verifyConnection, initSchema, closeDriver, getSession } from '../dist/neo4j.js';
import { relate } from '../dist/tools/relate.js';
import { impact } from '../dist/tools/impact.js';

const testRepo = { url: 'test.com/org/test-impact', name: 'test-impact' };

describe('knowledge_impact (integration)', () => {
  before(async () => {
    const ok = await verifyConnection();
    assert.ok(ok, 'Neo4j must be running for integration tests');
    await initSchema();

    // Clean any leftover test data
    const session = getSession();
    await session.run(`MATCH (p:Product) WHERE p.name STARTS WITH 'impact-' DETACH DELETE p`);
    await session.close();

    // Create product relationships: impact-web -> impact-api, impact-ios -> impact-api
    await relate({ from: 'impact-web', to: 'impact-api', relationship: 'DEPENDS_ON', detail: 'Web frontend calls API' });
    await relate({ from: 'impact-ios', to: 'impact-api', relationship: 'COMMUNICATES_WITH', detail: 'iOS app uses REST API' });
  });

  after(async () => {
    const session = getSession();
    await session.run(`MATCH (p:Product) WHERE p.name STARTS WITH 'impact-' DETACH DELETE p`);
    await session.close();
    await closeDriver();
  });

  it('returns the directly affected product', async () => {
    const result = await impact({ change: 'Refactor auth endpoints', product: 'impact-api' }, testRepo);

    assert.strictEqual(result.directly_affected, 'impact-api', 'directly_affected should be impact-api');
  });

  it('returns 2+ connected products for impact-api', async () => {
    const result = await impact({ change: 'Refactor auth endpoints', product: 'impact-api' }, testRepo);

    assert.ok(Array.isArray(result.connected_products), 'connected_products should be an array');
    assert.ok(result.connected_products.length >= 2, `Should find at least 2 connected products, got: ${result.connected_products.length}`);

    const names = result.connected_products.map((p) => p.name);
    assert.ok(names.includes('impact-web'), `connected_products should include impact-web, got: ${JSON.stringify(names)}`);
    assert.ok(names.includes('impact-ios'), `connected_products should include impact-ios, got: ${JSON.stringify(names)}`);
  });

  it('each connected product has name, relationship, and detail fields', async () => {
    const result = await impact({ change: 'Refactor auth endpoints', product: 'impact-api' }, testRepo);

    for (const cp of result.connected_products) {
      assert.ok(typeof cp.name === 'string', 'connected product name should be a string');
      assert.ok(typeof cp.relationship === 'string', 'connected product relationship should be a string');
      // detail may be null or string
      assert.ok(cp.detail === null || typeof cp.detail === 'string', 'connected product detail should be null or string');
    }
  });

  it('returns rules_at_risk as an array', async () => {
    const result = await impact({ change: 'Refactor auth endpoints', product: 'impact-api' }, testRepo);

    assert.ok(Array.isArray(result.rules_at_risk), 'rules_at_risk should be an array');
  });

  it('returns empty connected_products for unknown product', async () => {
    const result = await impact({ change: 'Some change', product: 'impact-nonexistent-xyz' }, testRepo);

    assert.strictEqual(result.directly_affected, 'impact-nonexistent-xyz');
    assert.ok(Array.isArray(result.connected_products), 'connected_products should be an array');
    assert.strictEqual(result.connected_products.length, 0, 'Should have no connected products for unknown product');
  });

  it('outgoing relationship from impact-web shows impact-api', async () => {
    const result = await impact({ change: 'Update web UI', product: 'impact-web' }, testRepo);

    assert.ok(result.connected_products.some((p) => p.name === 'impact-api'), 'impact-web should connect to impact-api');
  });
});
