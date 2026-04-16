import neo4j, { Driver, Session } from 'neo4j-driver';

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'knowledge-graph-local';
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function verifyConnection(): Promise<boolean> {
  try {
    const session = getSession();
    await session.run('RETURN 1');
    await session.close();
    return true;
  } catch (err) {
    console.error('[Knowledge] Neo4j not reachable. Start it with: docker compose up -d');
    return false;
  }
}

const SCHEMA_STATEMENTS = [
  'CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (d:Decision) REQUIRE d.id IS UNIQUE',
  'CREATE CONSTRAINT constraint_id IF NOT EXISTS FOR (c:Constraint) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT rule_id IF NOT EXISTS FOR (r:Rule) REQUIRE r.id IS UNIQUE',
  'CREATE CONSTRAINT product_name IF NOT EXISTS FOR (p:Product) REQUIRE p.name IS UNIQUE',
  'CREATE CONSTRAINT repo_url IF NOT EXISTS FOR (r:Repo) REQUIRE r.url IS UNIQUE',
  'CREATE CONSTRAINT tech_name_ver IF NOT EXISTS FOR (t:Technology) REQUIRE (t.name, t.version) IS UNIQUE',
  'CREATE CONSTRAINT designrule_id IF NOT EXISTS FOR (d:DesignRule) REQUIRE d.id IS UNIQUE',
  'CREATE CONSTRAINT platformrule_id IF NOT EXISTS FOR (p:PlatformRule) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT feedback_id IF NOT EXISTS FOR (f:Feedback) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT violation_id IF NOT EXISTS FOR (v:Violation) REQUIRE v.id IS UNIQUE',
  'CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE',
];

const FULLTEXT_INDEX = `
  CREATE FULLTEXT INDEX knowledge_search IF NOT EXISTS
  FOR (n:Decision|Constraint|Rule|DesignRule|PlatformRule)
  ON EACH [n.title, n.detail, n.reasoning]
`;

export async function initSchema(): Promise<void> {
  const session = getSession();
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await session.run(stmt);
    }
    await session.run(FULLTEXT_INDEX);
    console.error('[Knowledge] Schema initialized');
  } catch (err: any) {
    if (!err.message?.includes('already exists')) {
      console.error('[Knowledge] Schema init warning:', err.message);
    }
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
