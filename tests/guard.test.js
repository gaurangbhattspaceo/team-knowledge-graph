"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert"));
const neo4j_js_1 = require("../dist/neo4j.js");
const ingest_js_1 = require("../dist/tools/ingest.js");
const guard_js_1 = require("../dist/tools/guard.js");
const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };
const CREATED_BY = 'test-guard';
(0, node_test_1.describe)('knowledge_guard (integration)', () => {
    (0, node_test_1.before)(async () => {
        const ok = await (0, neo4j_js_1.verifyConnection)();
        assert.ok(ok, 'Neo4j must be running for integration tests');
        await (0, neo4j_js_1.initSchema)();
        // Clean test data
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
        await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestGuard' DETACH DELETE p`);
        await session.close();
    });
    (0, node_test_1.after)(async () => {
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
        await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestGuard' DETACH DELETE p`);
        await session.run(`MATCH (p:Product {name: 'test-guard-product'}) DETACH DELETE p`);
        await session.close();
        await (0, neo4j_js_1.closeDriver)();
    });
    (0, node_test_1.it)('returns matching rules for product + pattern', async () => {
        // Seed rules via ingest
        const ingested = await (0, ingest_js_1.ingest)({
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
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
        for (const ruleId of ingested.rule_ids) {
            await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
        }
        await session.close();
        // Call guard with matching product + pattern
        const result = await (0, guard_js_1.guard)({
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
    (0, node_test_1.it)('returns global rules even with non-matching pattern', async () => {
        // Seed a global rule
        const ingested = await (0, ingest_js_1.ingest)({
            source: 'TestGuardCSM',
            role: 'csm',
            feedback: 'All screens must have accessibility labels.',
            products: ['test-guard-product'],
            rules: [
                { title: 'TestGuard all screens must have accessibility labels', type: 'design', severity: 'must', scope: 'global' },
            ],
        }, testRepo);
        // Tag for cleanup
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
        for (const ruleId of ingested.rule_ids) {
            await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
        }
        await session.close();
        // Call guard with non-matching pattern
        const result = await (0, guard_js_1.guard)({
            description: 'Building payment checkout flow',
            products: ['test-guard-product'],
            patterns: ['payment'],
        }, testRepo);
        const titles = result.rules.map((r) => r.title);
        assert.ok(titles.some((t) => t.includes('TestGuard all screens must have accessibility labels')), 'Should include global rule even when pattern does not match');
    });
    (0, node_test_1.it)('sorts by repeat_count DESC then severity', async () => {
        // Seed rules with different severities
        const ingested = await (0, ingest_js_1.ingest)({
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
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: ingested.feedback_id, tag: CREATED_BY });
        for (const ruleId of ingested.rule_ids) {
            await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
        }
        await session.close();
        const result = await (0, guard_js_1.guard)({
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
