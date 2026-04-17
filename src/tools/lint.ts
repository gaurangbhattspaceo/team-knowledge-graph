import { z } from 'zod';
import { getSession } from '../neo4j.js';
import { RepoInfo } from '../git.js';

export const lintSchema = z.object({
  fix: z.boolean().optional().default(false).describe('If true, auto-fix stale entries by marking them'),
});

export type LintInput = z.infer<typeof lintSchema>;

interface LintIssue {
  type: 'stale' | 'orphan' | 'contradiction' | 'ambiguous' | 'duplicate';
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  nodeTitle?: string;
}

export async function lint(input: LintInput, repo: RepoInfo | null): Promise<{ issues: LintIssue[]; fixed: number; healthy: boolean }> {
  const session = getSession();
  const issues: LintIssue[] = [];
  let fixed = 0;

  try {
    // 1. Stale entries: older than 90 days with no RELATED_TO connections (isolated knowledge)
    const staleResult = await session.run(
      `MATCH (n)
       WHERE ANY(label IN labels(n) WHERE label IN ['Decision', 'Constraint', 'Rule'])
       AND n.date < $cutoff
       AND NOT (n)-[:RELATED_TO]-()
       AND NOT (n)-[:AFFECTS|GOVERNS|APPLIES_TO]->()
       RETURN [l IN labels(n) WHERE l IN ['Decision','Constraint','Rule']][0] AS type,
              n.id AS id, n.title AS title, n.date AS date`,
      { cutoff: getDateDaysAgo(90) }
    );
    for (const record of staleResult.records) {
      issues.push({
        type: 'stale',
        severity: 'warning',
        message: `${record.get('type')} from ${record.get('date')} has no connections — may be outdated`,
        nodeId: record.get('id'),
        nodeTitle: record.get('title'),
      });
    }

    // 2. Orphan nodes: Products or Technologies with no incoming edges
    const orphanResult = await session.run(
      `MATCH (n)
       WHERE (n:Product OR n:Technology)
       AND NOT ()-[:AFFECTS|GOVERNS|APPLIES_TO|USES|RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->(n)
       AND NOT (n)-[:AFFECTS|GOVERNS|APPLIES_TO|USES|RELATES_TO|DEPENDS_ON|COMMUNICATES_WITH]->()
       RETURN labels(n)[0] AS type, n.name AS name, n.version AS version`
    );
    for (const record of orphanResult.records) {
      const type = record.get('type');
      const name = record.get('name');
      const version = record.get('version');
      issues.push({
        type: 'orphan',
        severity: 'info',
        message: `${type} "${name}${version ? '@' + version : ''}" has no connections — consider removing`,
      });
    }

    // 3. Potential contradictions: active decisions that supersede each other or touch same product with conflicting titles
    const contradictionResult = await session.run(
      `MATCH (d1:Decision {status: 'active'})-[:AFFECTS]->(p:Product)<-[:AFFECTS]-(d2:Decision {status: 'active'})
       WHERE d1.id < d2.id
       AND d1.title CONTAINS d2.title OR d2.title CONTAINS d1.title
       RETURN d1.id AS id1, d1.title AS title1, d2.id AS id2, d2.title AS title2, p.name AS product`
    );
    for (const record of contradictionResult.records) {
      issues.push({
        type: 'contradiction',
        severity: 'error',
        message: `Two active decisions for "${record.get('product')}" may conflict: "${record.get('title1')}" vs "${record.get('title2')}"`,
        nodeId: record.get('id1'),
        nodeTitle: record.get('title1'),
      });
    }

    // 4. Ambiguous confidence entries that need review
    const ambiguousResult = await session.run(
      `MATCH (n)
       WHERE ANY(label IN labels(n) WHERE label IN ['Decision', 'Constraint', 'Rule'])
       AND n.confidence = 'ambiguous'
       RETURN [l IN labels(n) WHERE l IN ['Decision','Constraint','Rule']][0] AS type,
              n.id AS id, n.title AS title`
    );
    for (const record of ambiguousResult.records) {
      issues.push({
        type: 'ambiguous',
        severity: 'warning',
        message: `${record.get('type')} marked as ambiguous — needs human review: "${record.get('title')}"`,
        nodeId: record.get('id'),
        nodeTitle: record.get('title'),
      });
    }

    // 5. Potential duplicates: entries with very similar titles
    const dupResult = await session.run(
      `MATCH (a), (b)
       WHERE ANY(la IN labels(a) WHERE la IN ['Decision', 'Constraint', 'Rule'])
       AND ANY(lb IN labels(b) WHERE lb IN ['Decision', 'Constraint', 'Rule'])
       AND a.id < b.id
       AND (a.title CONTAINS b.title OR b.title CONTAINS a.title)
       AND size(a.title) > 20 AND size(b.title) > 20
       RETURN a.id AS id1, a.title AS title1, b.id AS id2, b.title AS title2
       LIMIT 5`
    );
    for (const record of dupResult.records) {
      issues.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Possible duplicate: "${record.get('title1')}" and "${record.get('title2')}"`,
        nodeId: record.get('id1'),
        nodeTitle: record.get('title1'),
      });
    }

    // Auto-fix stale entries if requested
    if (input.fix && issues.filter(i => i.type === 'stale').length > 0) {
      const staleIds = issues.filter(i => i.type === 'stale' && i.nodeId).map(i => i.nodeId);
      const fixResult = await session.run(
        `MATCH (n)
         WHERE n.id IN $ids
         SET n.status = 'stale'
         RETURN count(n) AS fixed`,
        { ids: staleIds }
      );
      fixed = toNum(fixResult.records[0]?.get('fixed'));
    }

    return {
      issues,
      fixed,
      healthy: issues.filter(i => i.severity === 'error').length === 0,
    };
  } finally {
    await session.close();
  }
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function toNum(v: any): number {
  return typeof v === 'object' && v?.toNumber ? v.toNumber() : Number(v || 0);
}
