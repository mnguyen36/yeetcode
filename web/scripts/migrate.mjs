// Applies lib/schema.sql to the database in DATABASE_URL. Idempotent —
// everything in the schema uses "if not exists", so re-running is safe.
//
//   DATABASE_URL='postgres://...' npm run db:migrate
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "lib", "schema.sql"), "utf8");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  console.error("Neon: use the pooled connection string (host contains '-pooler').");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.columns
     where table_name = 'runs'`
  );
  console.log(`schema applied — runs table has ${rows[0].n} columns`);
} finally {
  await client.end();
}
