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
const decide_js_1 = require("../dist/tools/decide.js");
const constraint_js_1 = require("../dist/tools/constraint.js");
const rule_js_1 = require("../dist/tools/rule.js");
const query_js_1 = require("../dist/tools/query.js");
const relate_js_1 = require("../dist/tools/relate.js");
const status_js_1 = require("../dist/tools/status.js");
const testRepo = { url: 'test.com/org/test-repo', name: 'test-repo' };
(0, node_test_1.describe)('knowledge tools (integration)', () => {
    (0, node_test_1.before)(async () => {
        const ok = await (0, neo4j_js_1.verifyConnection)();
        assert.ok(ok, 'Neo4j must be running for integration tests');
        await (0, neo4j_js_1.initSchema)();
        // Clean test data
        const session = (0, neo4j_js_1.getSession)();
        await session.run("MATCH (n) WHERE n.createdBy = 'test' DETACH DELETE n");
        await session.close();
    });
    (0, node_test_1.after)(async () => {
        const session = (0, neo4j_js_1.getSession)();
        await session.run("MATCH (n) WHERE n.createdBy = 'test' DETACH DELETE n");
        await session.close();
        await (0, neo4j_js_1.closeDriver)();
    });
    (0, node_test_1.it)('stores and queries a decision', async () => {
        const d = await (0, decide_js_1.decide)({
            title: 'Test decision for integration',
            reasoning: 'For testing purposes',
            products: ['test-product'],
            technologies: ['testlib@1.0.0'],
        }, testRepo);
        assert.ok(d.id);
        assert.ok(d.stored);
        // Tag for cleanup
        const session = (0, neo4j_js_1.getSession)();
        await session.run("MATCH (d:Decision {id: $id}) SET d.createdBy = 'test'", { id: d.id });
        await session.close();
        const q = await (0, query_js_1.query)({ query: 'Test decision integration', type: 'all', limit: 5 }, testRepo);
        assert.ok(q.results.length > 0, 'Should find the decision');
        const found = q.results.find((r) => r.id === d.id);
        assert.ok(found, 'Should find by ID');
    });
    (0, node_test_1.it)('stores a constraint', async () => {
        const c = await (0, constraint_js_1.constraint)({
            title: 'Test constraint for integration',
            detail: 'Something does not work',
            severity: 'warning',
            products: ['test-product'],
        }, testRepo);
        assert.ok(c.id);
        assert.ok(c.stored);
        const session = (0, neo4j_js_1.getSession)();
        await session.run("MATCH (c:Constraint {id: $id}) SET c.createdBy = 'test'", { id: c.id });
        await session.close();
    });
    (0, node_test_1.it)('stores a rule', async () => {
        const r = await (0, rule_js_1.rule)({
            title: 'Test rule for integration',
            detail: 'A business rule',
            domain: 'testing',
            products: ['test-product'],
        }, testRepo);
        assert.ok(r.id);
        assert.ok(r.stored);
        const session = (0, neo4j_js_1.getSession)();
        await session.run("MATCH (r:Rule {id: $id}) SET r.createdBy = 'test'", { id: r.id });
        await session.close();
    });
    (0, node_test_1.it)('records a product relationship', async () => {
        const result = await (0, relate_js_1.relate)({
            from: 'test-product',
            to: 'other-test-product',
            relationship: 'calls via API',
        });
        assert.ok(result.stored);
    });
    (0, node_test_1.it)('returns status with counts', async () => {
        const s = await (0, status_js_1.status)({ scope: 'global' }, testRepo);
        assert.ok(s.counts.decisions >= 1, 'Should have at least 1 decision');
        assert.ok(s.counts.constraints >= 1, 'Should have at least 1 constraint');
        assert.ok(s.counts.rules >= 1, 'Should have at least 1 rule');
        assert.ok(s.counts.products >= 1, 'Should have at least 1 product');
    });
});
