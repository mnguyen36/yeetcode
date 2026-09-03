import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH =
  process.env.YEETCODE_DB ?? path.join(process.cwd(), "..", "data", "yeetcode.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  }
  return db;
}

export type Testcase = { argsJson: string; expectedJson: string };

export type ProblemRound = {
  id: number;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  language: string;
  code: string;
  content: string | null;
  fnName: string | null;
  runnable: boolean;
  testcases: Testcase[];
};

export type ProblemListing = {
  id: number;
  title: string;
  slug: string;
  difficulty: ProblemRound["difficulty"];
  runnable: boolean;
};

// Code is typed character-for-character, so normalize quirks that would make
// typing miserable: tabs and trailing whitespace.
function prepareCode(raw: string): string {
  return raw
    .replaceAll("\t", "    ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

const MIN_LEN = 40;
const MAX_LEN = 2400;

const ROUND_SELECT = `
  SELECT p.id, p.title, p.slug, p.difficulty, p.content_html AS content,
         p.meta_json AS metaJson, p.runnable, s.code, s.language
  FROM solutions s JOIN problems p ON p.id = s.problem_id`;

type RoundRow = {
  id: number;
  title: string;
  slug: string;
  difficulty: ProblemRound["difficulty"];
  content: string | null;
  metaJson: string | null;
  runnable: number;
  code: string;
  language: string;
};

function toRound(row: RoundRow): ProblemRound {
  const d = getDb();
  const tags = (
    d
      .prepare(
        `SELECT t.name FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
         WHERE pt.problem_id = ? ORDER BY t.name`
      )
      .all(row.id) as { name: string }[]
  ).map((t) => t.name);

  const testcases = d
    .prepare(
      `SELECT args_json AS argsJson, expected_json AS expectedJson
       FROM testcases WHERE problem_id = ? ORDER BY ordinal`
    )
    .all(row.id) as Testcase[];

  let fnName: string | null = null;
  if (row.metaJson) {
    try {
      fnName = JSON.parse(row.metaJson).name ?? null;
    } catch {
      /* unparseable metadata -> not runnable anyway */
    }
  }

  const { metaJson: _metaJson, runnable, ...rest } = row;
  return {
    ...rest,
    tags,
    code: prepareCode(row.code),
    fnName,
    runnable: runnable === 1,
    testcases,
  };
}

export function randomRound(opts: {
  language: string;
  difficulty?: string;
  excludeId?: number;
}): ProblemRound | null {
  const row = getDb()
    .prepare(
      `${ROUND_SELECT}
       WHERE s.language = @language
         AND (@difficulty IS NULL OR p.difficulty = @difficulty)
         AND length(s.code) BETWEEN ${MIN_LEN} AND ${MAX_LEN}
         AND p.id != COALESCE(@excludeId, -1)
       ORDER BY RANDOM() LIMIT 1`
    )
    .get({
      language: opts.language,
      difficulty: opts.difficulty ?? null,
      excludeId: opts.excludeId ?? null,
    }) as RoundRow | undefined;
  return row ? toRound(row) : null;
}

export function problemRound(opts: {
  id: number;
  language: string;
}): ProblemRound | null {
  const row = getDb()
    .prepare(`${ROUND_SELECT} WHERE p.id = @id AND s.language = @language LIMIT 1`)
    .get(opts) as RoundRow | undefined;
  return row ? toRound(row) : null;
}

export function listProblems(opts: {
  language: string;
  difficulty?: string;
}): ProblemListing[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.title, p.slug, p.difficulty, p.runnable
       FROM solutions s JOIN problems p ON p.id = s.problem_id
       WHERE s.language = @language
         AND (@difficulty IS NULL OR p.difficulty = @difficulty)
         AND length(s.code) BETWEEN ${MIN_LEN} AND ${MAX_LEN}
       ORDER BY p.id`
    )
    .all({
      language: opts.language,
      difficulty: opts.difficulty ?? null,
    }) as (Omit<ProblemListing, "runnable"> & { runnable: number })[];
  return rows.map((r) => ({ ...r, runnable: r.runnable === 1 }));
}

export function meta() {
  const d = getDb();
  const languages = d
    .prepare(
      `SELECT language, COUNT(DISTINCT problem_id) AS problems
       FROM solutions WHERE length(code) BETWEEN ${MIN_LEN} AND ${MAX_LEN}
       GROUP BY language ORDER BY problems DESC`
    )
    .all() as { language: string; problems: number }[];
  return { languages, difficulties: ["Easy", "Medium", "Hard"] };
}
