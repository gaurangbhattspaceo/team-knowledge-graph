// Products
MERGE (p1:Product {name: 'ai-agent'})
MERGE (p2:Product {name: 'solver'})
MERGE (p3:Product {name: 'platform'})
MERGE (p4:Product {name: 'bridge-mcp'})

// Relationships
MERGE (p3)-[:COMMUNICATES_WITH {detail: 'POST /chat/stream SSE', date: '2026-03-31'}]->(p1)
MERGE (p1)-[:DEPENDS_ON {detail: 'via Bridge webhook, BullMQ', date: '2026-03-31'}]->(p2)
MERGE (p3)-[:COMMUNICATES_WITH {detail: 'HTTP MCP on port 3002', date: '2026-03-31'}]->(p4)

// Key constraints
CREATE (c1:Constraint {id: 'const-001', title: 'AI SDK v6: use inputSchema not parameters', detail: 'tool() function accepts inputSchema for Zod schemas. parameters was v5.', severity: 'breaking', date: '2026-03-31', createdBy: 'seed'})
MERGE (t1:Technology {name: 'ai', version: '6.0.141'})
MERGE (c1)-[:APPLIES_TO]->(t1)
MERGE (c1)-[:APPLIES_TO]->(p1)

CREATE (c2:Constraint {id: 'const-002', title: 'AI SDK v6: use stopWhen: stepCountIs(N) not maxSteps', detail: 'maxSteps removed in v6. Use stopWhen with stepCountIs() from ai package.', severity: 'breaking', date: '2026-03-31', createdBy: 'seed'})
MERGE (c2)-[:APPLIES_TO]->(t1)

CREATE (c3:Constraint {id: 'const-003', title: 'Sonnet does not support tool_search_bm25 or adaptive thinking', detail: 'tool_search_bm25_20251119 and thinking: {type: adaptive} are Opus-only features.', severity: 'breaking', date: '2026-03-31', createdBy: 'seed'})
MERGE (t2:Technology {name: 'anthropic-sdk', version: '3.0.64'})
MERGE (c3)-[:APPLIES_TO]->(t2)
MERGE (c3)-[:APPLIES_TO]->(p1)

// Key decisions
CREATE (d1:Decision {id: 'dec-001', title: 'Sonnet for 90% queries, Opus for plan changes only', reasoning: 'Sonnet is 5x cheaper ($3/MTok vs $15/MTok). Handles lookups, creates, settings fine. Opus needed only for multi-step schedule changes requiring tool_search + adaptive thinking.', date: '2026-03-31', status: 'active', createdBy: 'seed'})
MERGE (d1)-[:AFFECTS]->(p1)

CREATE (d2:Decision {id: 'dec-002', title: 'Dynamic prompt assembly by intent classification', reasoning: '74% system prompt reduction. Core rules always sent (~1500 tokens). Workflow sections loaded by intent.', date: '2026-03-31', status: 'active', createdBy: 'seed'})
MERGE (d2)-[:AFFECTS]->(p1)

CREATE (d3:Decision {id: 'dec-003', title: 'Chat messages deduct credits (Sonnet=1, Opus=8)', reasoning: 'Credits shared pool with dispatch runs. No separate billing system needed.', date: '2026-03-31', status: 'active', createdBy: 'seed'})
MERGE (d3)-[:AFFECTS]->(p1)
MERGE (d3)-[:AFFECTS]->(p3)

// Business rules
CREATE (r1:Rule {id: 'rule-001', title: 'Plan credits: Free=100, Starter=500, Pro=3000, Enterprise=10000', detail: 'Monthly allotment. Shared between dispatch runs and AI chat.', domain: 'billing', date: '2026-03-31', createdBy: 'seed'})
MERGE (r1)-[:GOVERNS]->(p3)

CREATE (r2:Rule {id: 'rule-002', title: 'Solver has 28 hard + 30 soft constraints, all configurable per request', detail: 'ConstraintWeights passed per API call via ThreadLocal context.', domain: 'scheduling', date: '2026-03-31', createdBy: 'seed'})
MERGE (r2)-[:GOVERNS]->(p2)

CREATE (r3:Rule {id: 'rule-003', title: 'overageRate defined in plans but NOT implemented in code', detail: 'plans.ts has overageRate per plan. consumeCredits() blocks on zero. No auto-charge.', domain: 'billing', date: '2026-03-31', createdBy: 'seed'})
MERGE (r3)-[:GOVERNS]->(p3)
;
