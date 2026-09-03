// Shared helpers for walking the neetcode solutions repo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const LANGUAGE_DIRS = {
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  dart: "dart",
  go: "go",
  java: "java",
  javascript: "javascript",
  kotlin: "kotlin",
  python: "python",
  ruby: "ruby",
  rust: "rust",
  scala: "scala",
  swift: "swift",
  typescript: "typescript",
};

const FILE_RE = /^(\d{1,5})-(.+)\.[^.]+$/;

// Yields { problemId, slug, language, path } for every parseable solution file.
export function* walkSolutions(repoRoot) {
  for (const [language, dir] of Object.entries(LANGUAGE_DIRS)) {
    const abs = join(repoRoot, dir);
    let files;
    try {
      files = readdirSync(abs);
    } catch {
      continue;
    }
    for (const file of files) {
      const m = file.match(FILE_RE);
      if (!m) continue;
      yield {
        problemId: Number(m[1]),
        slug: m[2].toLowerCase(),
        language,
        path: join(abs, file),
      };
    }
  }
}

export function collectSolutionIds(repoRoot) {
  const ids = new Set();
  for (const s of walkSolutions(repoRoot)) ids.add(s.problemId);
  return ids;
}

export function readSolutionCode(path) {
  const code = readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim();
  return code.length >= 20 ? code : null; // skip empty/placeholder files
}
