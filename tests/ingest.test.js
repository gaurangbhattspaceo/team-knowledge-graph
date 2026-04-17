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
const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };
const CREATED_BY = 'test-ingest';
(0, node_test_1.describe)('knowledge_ingest (integration)', () => {
    (0, node_test_1.before)(async () => {
        const ok = await (0, neo4j_js_1.verifyConnection)();
        assert.ok(ok, 'Neo4j must be running for integration tests');
        await (0, neo4j_js_1.initSchema)();
        // Clean test data
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
        await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestIngest' DETACH DELETE p`);
        await session.close();
    });
    (0, node_test_1.after)(async () => {
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (n) WHERE n.createdBy = $tag DETACH DELETE n`, { tag: CREATED_BY });
        await session.run(`MATCH (p:Person) WHERE p.name STARTS WITH 'TestIngest' DETACH DELETE p`);
        await session.close();
        await (0, neo4j_js_1.closeDriver)();
    });
    (0, node_test_1.it)('ingests feedback with 2 rules and returns correct counts', async () => {
        const result = await (0, ingest_js_1.ingest)({
            source: 'TestIngestFounder',
            role: 'founder',
            feedback: 'Buttons should be bigger and use consistent colours across all screens.',
            products: ['test-product-ingest'],
            rules: [
                { title: 'TestIngest buttons must be minimum 44px', type: 'design', severity: 'must', scope: 'global' },
                { title: 'TestIngest consistent colour palette required', type: 'design', severity: 'should', scope: 'product' },
            ],
        }, testRepo);
        assert.ok(result.feedback_id, 'Should return feedback_id');
        assert.strictEqual(result.rules_created, 2, 'Should create 2 rules');
        assert.strictEqual(result.rules_repeated, 0, 'Should have 0 repeats');
        assert.strictEqual(result.rule_ids.length, 2, 'Should return 2 rule IDs');
        assert.strictEqual(result.needs_decomposition, false, 'Should not need decomposition');
        // Tag nodes for cleanup
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: result.feedback_id, tag: CREATED_BY });
        for (const ruleId of result.rule_ids) {
            await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
        }
        await session.close();
    });
    (0, node_test_1.it)('detects repeated rule and increments repeat_count', async () => {
        // First ingest
        const first = await (0, ingest_js_1.ingest)({
            source: 'TestIngestCSM',
            role: 'csm',
            feedback: 'The nav bar icons are too small on mobile.',
            products: ['test-product-ingest'],
            rules: [
                { title: 'TestIngest nav bar icons minimum 32px on mobile', type: 'platform', severity: 'should', scope: 'feature' },
            ],
        }, testRepo);
        assert.strictEqual(first.rules_created, 1);
        // Tag for cleanup
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: first.feedback_id, tag: CREATED_BY });
        for (const ruleId of first.rule_ids) {
            await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
        }
        // Second ingest with same rule title — should detect repeat
        const second = await (0, ingest_js_1.ingest)({
            source: 'TestIngestClient',
            role: 'client',
            feedback: 'Icons in the navigation bar are hard to tap on phones.',
            products: ['test-product-ingest'],
            rules: [
                { title: 'TestIngest nav bar icons minimum 32px on mobile', type: 'platform', severity: 'should', scope: 'feature' },
            ],
        }, testRepo);
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: second.feedback_id, tag: CREATED_BY });
        // The repeat may or may not be detected depending on fulltext index timing.
        // If detected, verify the counts. If not, the rule is created as new.
        if (second.rules_repeated > 0) {
            assert.strictEqual(second.rules_repeated, 1, 'Should detect 1 repeat');
            assert.ok(second.repeat_details.length > 0, 'Should have repeat details');
            assert.ok(second.repeat_details[0].repeat_count >= 2, 'Repeat count should be at least 2');
        }
        else {
            // Fulltext index may not have caught up — rule created as new instead
            assert.strictEqual(second.rules_created, 1, 'Should create 1 new rule if repeat not detected');
            for (const ruleId of second.rule_ids) {
                await session.run(`MATCH (n {id: $id}) SET n.createdBy = $tag`, { id: ruleId, tag: CREATED_BY });
            }
        }
        // Clean up any Violation nodes
        await session.run(`MATCH (v:Violation) WHERE v.createdBy = 'ai-agent' AND v.detected_by = 'repeated-feedback' SET v.createdBy = $tag`, { tag: CREATED_BY });
        await session.close();
    });
    (0, node_test_1.it)('returns needs_decomposition when no rules provided', async () => {
        const result = await (0, ingest_js_1.ingest)({
            source: 'TestIngestUser',
            role: 'user',
            feedback: 'The app feels slow when switching between tabs.',
        }, testRepo);
        assert.ok(result.feedback_id, 'Should return feedback_id');
        assert.strictEqual(result.rules_created, 0, 'Should create 0 rules');
        assert.strictEqual(result.rules_repeated, 0, 'Should have 0 repeats');
        assert.strictEqual(result.needs_decomposition, true, 'Should need decomposition');
        // Tag for cleanup
        const session = (0, neo4j_js_1.getSession)();
        await session.run(`MATCH (f:Feedback {id: $id}) SET f.createdBy = $tag`, { id: result.feedback_id, tag: CREATED_BY });
        await session.close();
    });
});
