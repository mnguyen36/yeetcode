// Fetches the full LeetCode problem list (with topic tags) via the public
// GraphQL endpoint, paged 100 at a time, into data/raw/problems.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "problems.json");

const QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      frontendQuestionId: questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      acRate
      topicTags { name slug }
    }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(variables, attempt = 1) {
  const res = await fetch("https://leetcode.com/graphql/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: "https://leetcode.com/problemset/",
    },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  if (!res.ok) {
    if (attempt <= 3) {
      console.warn(`HTTP ${res.status}, retrying (attempt ${attempt})...`);
      await sleep(2000 * attempt);
      return gql(variables, attempt + 1);
    }
    throw new Error(`GraphQL request failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.problemsetQuestionList;
}

const PAGE = 100;
const all = [];
let total = Infinity;
for (let skip = 0; skip < total; skip += PAGE) {
  const { total: t, questions } = await gql({
    categorySlug: "",
    limit: PAGE,
    skip,
    filters: {},
  });
  total = t;
  all.push(...questions);
  console.log(`fetched ${all.length}/${total}`);
  await sleep(300);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(all, null, 1));
console.log(`wrote ${all.length} problems to ${OUT}`);
