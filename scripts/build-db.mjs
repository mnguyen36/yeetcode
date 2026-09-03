// Rebuilds data/yeetcode.db from the raw inputs:
//   data/raw/problems.json      - LeetCode metadata + tags (fetch-problems.mjs)
//   data/raw/content/<slug>.json - question descriptions (fetch-content.mjs, optional)
//   data/raw/neetcode/           - MIT-licensed solutions repo (git clone)
// Idempotent: drops and recreates all tables on every run.
import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { walkSolutions, readSolutionCode } from "./lib/solutions.mjs";
import { buildTestcases } from "./lib/testcases.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw");
const DB_PATH = join(ROOT, "data", "yeetcode.db");

const problems = JSON.parse(readFileSync(join(RAW, "problems.json"), "utf8"));

mkdirSync(join(ROOT, "data"), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
DROP TABLE IF EXISTS testcases;
DROP TABLE IF EXISTS problem_tags;
DROP TABLE IF EXISTS solutions;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS problems;

CREATE TABLE problems (
  id           INTEGER PRIMARY KEY,      -- LeetCode frontend question id
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  paid_only    INTEGER NOT NULL DEFAULT 0,
  ac_rate      REAL,
  content_html TEXT,                     -- NULL until description is fetched
  hints_json   TEXT,
  meta_json    TEXT,                     -- LeetCode metaData (entry point signature)
  runnable     INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'leetcode'
);

CREATE TABLE testcases (
  problem_id    INTEGER NOT NULL REFERENCES problems(id),
  ordinal       INTEGER NOT NULL,
  args_json     TEXT NOT NULL,           -- JSON array of argument values
  expected_json TEXT NOT NULL,           -- JSON value
  PRIMARY KEY (problem_id, ordinal)
);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE problem_tags (
  problem_id INTEGER NOT NULL REFERENCES problems(id),
  tag_id     INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (problem_id, tag_id)
);

CREATE TABLE solutions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id),
  language    TEXT NOT NULL,
  code        TEXT NOT NULL,
  source      TEXT NOT NULL,             -- e.g. 'neetcode'
  source_path TEXT NOT NULL,
  license     TEXT NOT NULL,
  UNIQUE (problem_id, language, source)
);

CREATE INDEX idx_solutions_problem ON solutions(problem_id);
CREATE INDEX idx_problems_difficulty ON problems(difficulty);
`);

// --- problems + tags ---------------------------------------------------
const insProblem = db.prepare(
  `INSERT INTO problems (id, slug, title, difficulty, paid_only, ac_rate)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const insTag = db.prepare(`INSERT OR IGNORE INTO tags (slug, name) VALUES (?, ?)`);
const getTag = db.prepare(`SELECT id FROM tags WHERE slug = ?`);
const insProblemTag = db.prepare(
  `INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)`
);

const loadProblems = db.transaction(() => {
  for (const p of problems) {
    const id = Number(p.frontendQuestionId);
    if (!Number.isInteger(id)) continue;
    insProblem.run(id, p.titleSlug, p.title, p.difficulty, p.isPaidOnly ? 1 : 0, p.acRate);
    for (const t of p.topicTags ?? []) {
      insTag.run(t.slug, t.name);
      insProblemTag.run(id, getTag.get(t.slug).id);
    }
  }
});
loadProblems();

// --- descriptions (optional, whatever has been fetched so far) ---------
const contentDir = join(RAW, "content");
const updContent = db.prepare(
  `UPDATE problems SET content_html = ?, hints_json = ? WHERE slug = ?`
);
let contentCount = 0;
const contentBySlug = new Map(); // slug -> { content, exampleTestcases }
if (existsSync(contentDir)) {
  const loadContent = db.transaction(() => {
    for (const f of readdirSync(contentDir)) {
      if (!f.endsWith(".json")) continue;
      const q = JSON.parse(readFileSync(join(contentDir, f), "utf8"));
      if (!q.content) continue;
      contentBySlug.set(q.slug, q);
      const res = updContent.run(q.content, JSON.stringify(q.hints ?? []), q.slug);
      contentCount += res.changes;
    }
  });
  loadContent();
}

// --- testcases (optional, needs data/raw/meta from fetch-meta.mjs) -----
const metaDir = join(RAW, "meta");
const updMeta = db.prepare(
  `UPDATE problems SET meta_json = ?, runnable = ? WHERE slug = ?`
);
const insCase = db.prepare(
  `INSERT INTO testcases (problem_id, ordinal, args_json, expected_json)
   SELECT id, ?, ?, ? FROM problems WHERE slug = ?`
);
let runnableCount = 0, caseCount = 0;
if (existsSync(metaDir)) {
  const loadMeta = db.transaction(() => {
    for (const f of readdirSync(metaDir)) {
      if (!f.endsWith(".json")) continue;
      const { slug, metaData } = JSON.parse(readFileSync(join(metaDir, f), "utf8"));
      const q = contentBySlug.get(slug);
      const parsed = buildTestcases({
        metaData,
        exampleTestcases: q?.exampleTestcases,
        contentHtml: q?.content,
      });
      if (!parsed) {
        updMeta.run(metaData ?? null, 0, slug);
        continue;
      }
      updMeta.run(metaData, parsed.runnable ? 1 : 0, slug);
      parsed.cases.forEach((c, i) => {
        insCase.run(i, JSON.stringify(c.args), JSON.stringify(c.expected), slug);
        caseCount++;
      });
      if (parsed.runnable) runnableCount++;
    }
  });
  loadMeta();
}

// --- solutions ----------------------------------------------------------
const hasProblem = db.prepare(`SELECT 1 FROM problems WHERE id = ?`);
const problemSlug = db.prepare(`SELECT slug FROM problems WHERE id = ?`);
const insSolution = db.prepare(
  `INSERT INTO solutions (problem_id, language, code, source, source_path, license)
   VALUES (?, ?, ?, 'neetcode', ?, 'MIT')`
);
const updSolution = db.prepare(
  `UPDATE solutions SET code = ?, source_path = ?
   WHERE problem_id = ? AND language = ? AND source = 'neetcode'`
);
const getSolution = db.prepare(
  `SELECT id, source_path FROM solutions
   WHERE problem_id = ? AND language = ? AND source = 'neetcode'`
);

let solCount = 0, unmatched = 0;
const loadSolutions = db.transaction(() => {
  for (const s of walkSolutions(join(RAW, "neetcode"))) {
    if (!hasProblem.get(s.problemId)) { unmatched++; continue; }
    const code = readSolutionCode(s.path);
    if (!code) continue;
    const relPath = s.path.slice(join(RAW, "neetcode").length + 1).replaceAll("\\", "/");
    const existing = getSolution.get(s.problemId, s.language);
    if (!existing) {
      insSolution.run(s.problemId, s.language, code, relPath);
      solCount++;
    } else if (s.slug === problemSlug.get(s.problemId).slug) {
      // Duplicate file for the same problem+language (case-variant names):
      // prefer the one whose filename matches the canonical slug.
      updSolution.run(code, relPath, s.problemId, s.language);
    }
  }
});
loadSolutions();

// --- report -------------------------------------------------------------
const stats = {
  problems: db.prepare(`SELECT COUNT(*) n FROM problems`).get().n,
  withSolutions: db.prepare(`SELECT COUNT(DISTINCT problem_id) n FROM solutions`).get().n,
  solutions: db.prepare(`SELECT COUNT(*) n FROM solutions`).get().n,
  withContent: db.prepare(`SELECT COUNT(*) n FROM problems WHERE content_html IS NOT NULL`).get().n,
  tags: db.prepare(`SELECT COUNT(*) n FROM tags`).get().n,
};
console.log(`problems:            ${stats.problems}`);
console.log(`  with description:  ${stats.withContent}`);
console.log(`  with >=1 solution: ${stats.withSolutions}`);
console.log(`  runnable:          ${runnableCount} (${caseCount} testcases total)`);
console.log(`solutions:           ${stats.solutions} (skipped: ${unmatched} unmatched ids)`);
console.log(`tags:                ${stats.tags}`);
console.log(`\nper language:`);
for (const row of db
  .prepare(`SELECT language, COUNT(*) n FROM solutions GROUP BY language ORDER BY n DESC`)
  .all()) {
  console.log(`  ${row.language.padEnd(12)} ${row.n}`);
}
console.log(`\ndb: ${DB_PATH}`);
db.close();
