// Dumps the SQLite database to static JSON for the GitHub Pages build.
//
// Deliberately omits problems.content_html: the descriptions are LeetCode's
// prose and this output is committed to a public repo. Everything shipped here
// is either NeetCode's MIT-licensed solution code or short factual metadata.
//
//   node scripts/export-static.mjs
//   -> web/public/data/meta.json
//      web/public/data/lang-<language>.json
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.YEETCODE_DB ?? path.join(process.cwd(), "data", "yeetcode.db");
const OUT_DIR = path.join(process.cwd(), "web", "public", "data");

// Same bounds the server used, so the static site offers the same rounds.
const MIN_LEN = 40;
const MAX_LEN = 2400;

// Code is typed character-for-character, so normalize quirks that would make
// typing miserable: tabs and trailing whitespace.
function prepareCode(raw) {
  return raw
    .replaceAll("\t", "    ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const tagsByProblem = new Map();
for (const r of db
  .prepare(
    `SELECT pt.problem_id AS id, t.name FROM problem_tags pt
     JOIN tags t ON t.id = pt.tag_id ORDER BY pt.problem_id, t.name`
  )
  .all()) {
  if (!tagsByProblem.has(r.id)) tagsByProblem.set(r.id, []);
  tagsByProblem.get(r.id).push(r.name);
}

const casesByProblem = new Map();
for (const r of db
  .prepare(
    `SELECT problem_id AS id, args_json AS argsJson, expected_json AS expectedJson
     FROM testcases ORDER BY problem_id, ordinal`
  )
  .all()) {
  if (!casesByProblem.has(r.id)) casesByProblem.set(r.id, []);
  casesByProblem.get(r.id).push({ argsJson: r.argsJson, expectedJson: r.expectedJson });
}

const rows = db
  .prepare(
    `SELECT p.id, p.title, p.slug, p.difficulty, p.meta_json AS metaJson,
            p.runnable, s.code, s.language
     FROM solutions s JOIN problems p ON p.id = s.problem_id
     WHERE length(s.code) BETWEEN ${MIN_LEN} AND ${MAX_LEN}
     ORDER BY s.language, p.id`
  )
  .all();

const byLanguage = new Map();
for (const row of rows) {
  let fnName = null;
  if (row.metaJson) {
    try {
      fnName = JSON.parse(row.metaJson).name ?? null;
    } catch {
      /* unparseable metadata -> not runnable anyway */
    }
  }
  const round = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    difficulty: row.difficulty,
    tags: tagsByProblem.get(row.id) ?? [],
    language: row.language,
    code: prepareCode(row.code),
    fnName,
    runnable: row.runnable === 1,
    testcases: casesByProblem.get(row.id) ?? [],
  };
  if (!byLanguage.has(row.language)) byLanguage.set(row.language, []);
  byLanguage.get(row.language).push(round);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const languages = [...byLanguage.entries()]
  .map(([language, rounds]) => ({ language, problems: rounds.length }))
  .sort((a, b) => b.problems - a.problems);

writeFileSync(
  path.join(OUT_DIR, "meta.json"),
  JSON.stringify({ languages, difficulties: ["Easy", "Medium", "Hard"] })
);

let total = 0;
for (const [language, rounds] of byLanguage) {
  const json = JSON.stringify(rounds);
  writeFileSync(path.join(OUT_DIR, `lang-${language}.json`), json);
  total += json.length;
  console.log(
    `  lang-${language}.json`.padEnd(28),
    String(rounds.length).padStart(4),
    "rounds",
    (json.length / 1024).toFixed(0).padStart(5) + " KB"
  );
}
console.log(`\n${rows.length} rounds across ${byLanguage.size} languages`);
console.log(`${(total / 1048576).toFixed(2)} MB total (descriptions excluded)`);
