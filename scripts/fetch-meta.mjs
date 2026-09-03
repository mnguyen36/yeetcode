// Fetches question.metaData (entry-point function signature JSON) for every
// free problem that has at least one local solution. Resumable: skips slugs
// already present in data/raw/meta/<slug>.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSolutionIds } from "./lib/solutions.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBLEMS = JSON.parse(readFileSync(join(ROOT, "data", "raw", "problems.json"), "utf8"));
const OUT_DIR = join(ROOT, "data", "raw", "meta");
mkdirSync(OUT_DIR, { recursive: true });

const QUERY = `
query questionMeta($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    metaData
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchMeta(slug, attempt = 1) {
  const res = await fetch("https://leetcode.com/graphql/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: `https://leetcode.com/problems/${slug}/`,
    },
    body: JSON.stringify({ query: QUERY, variables: { titleSlug: slug } }),
  });
  if (!res.ok) {
    if (attempt <= 3) {
      await sleep(3000 * attempt);
      return fetchMeta(slug, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} for ${slug}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`${slug}: ${JSON.stringify(json.errors)}`);
  return json.data.question;
}

const wantedIds = collectSolutionIds(join(ROOT, "data", "raw", "neetcode"));
const targets = PROBLEMS.filter(
  (p) => !p.isPaidOnly && wantedIds.has(Number(p.frontendQuestionId))
);
console.log(`${targets.length} problems to fetch metaData for`);

let done = 0, skipped = 0, failed = 0;
for (const p of targets) {
  const outFile = join(OUT_DIR, `${p.titleSlug}.json`);
  if (existsSync(outFile)) { skipped++; continue; }
  try {
    const q = await fetchMeta(p.titleSlug);
    writeFileSync(outFile, JSON.stringify({ slug: p.titleSlug, metaData: q.metaData }, null, 1));
    done++;
    if (done % 50 === 0) console.log(`downloaded ${done} (skipped ${skipped})`);
  } catch (e) {
    failed++;
    console.warn(`FAILED ${p.titleSlug}: ${e.message}`);
  }
  await sleep(350);
}
console.log(`done: ${done} downloaded, ${skipped} already present, ${failed} failed`);
