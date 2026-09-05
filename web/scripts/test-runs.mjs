// Exercises lib/runs.ts against a real Postgres (PGlite, in-process) so the
// schema and every query are actually executed. No live database needed.
//
//   npm run db:test
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { register } from "node:module";

// runs.ts is TypeScript; transpile on the fly with the sucrase hook already
// in the dependency tree.
register("./ts-loader.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const { setExecutor, recordRun, problemStats, overallStats } = await import(
  "../lib/runs.ts"
);

const db = new PGlite();
setExecutor(async (sql, params) => (await db.query(sql, params)).rows);

await db.exec(readFileSync(join(here, "..", "lib", "schema.sql"), "utf8"));
console.log("schema applied");

const A = "device-aaaaaaaa-1111";
const B = "device-bbbbbbbb-2222";

const base = {
  problemId: 1, language: "python", difficulty: "Easy",
  accuracy: 97, keystrokes: 240, misses: 7, durationMs: 42_000,
};

await recordRun({ ...base, userKey: A, wpm: 55 });
await recordRun({ ...base, userKey: A, wpm: 71 });
await recordRun({ ...base, userKey: A, wpm: 64 });
await recordRun({ ...base, userKey: A, problemId: 297, language: "javascript",
                 difficulty: "Hard", wpm: 40 });
await recordRun({ ...base, userKey: B, wpm: 120 });

// per-problem: best is the max, last is the most recent by created_at
const p = await problemStats({ userKey: A, problemId: 1, language: "python" });
assert.equal(p.attempts, 3, "attempts");
assert.equal(p.bestWpm, 71, "bestWpm");
assert.equal(p.lastWpm, 64, "lastWpm is most recent, not max");
console.log("problemStats:", p);

// another user's rows must not leak in
const other = await problemStats({ userKey: B, problemId: 1, language: "python" });
assert.equal(other.attempts, 1);
assert.equal(other.bestWpm, 120);

// language is part of the key: same problem id, different language
const empty = await problemStats({ userKey: A, problemId: 1, language: "rust" });
assert.equal(empty.attempts, 0, "unseen language");
assert.equal(empty.bestWpm, null, "no rows -> null, not 0");
console.log("empty case:", empty);

const o = await overallStats(A);
assert.equal(o.attempts, 4, "overall attempts");
assert.equal(o.problems, 2, "distinct problems");
assert.equal(o.bestWpm, 71);
assert.equal(o.avgWpm, Math.round((55 + 71 + 64 + 40) / 4));
assert.equal(o.avgAccuracy, 97);
console.log("overallStats:", o);

const fresh = await overallStats("device-cccccccc-3333");
assert.equal(fresh.attempts, 0);
assert.equal(fresh.avgWpm, null, "no rows -> null");
console.log("fresh user:", fresh);

// constraints reject impossible values rather than storing them
await assert.rejects(
  () => recordRun({ ...base, userKey: A, wpm: 55, accuracy: 150 }),
  /accuracy/,
  "accuracy > 100 must violate the check constraint"
);
await assert.rejects(
  () => recordRun({ ...base, userKey: A, wpm: 55, durationMs: 0 }),
  /duration_ms/,
  "zero duration must violate the check constraint"
);
console.log("check constraints hold");

await db.close();
console.log("\nall assertions passed");
