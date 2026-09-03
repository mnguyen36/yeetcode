// Quick sanity checks on the built database.
import Database from "better-sqlite3";
const db = new Database("data/yeetcode.db", { readonly: true });

console.log("difficulty spread (problems with solutions):");
console.log(
  db.prepare(
    `SELECT difficulty, COUNT(DISTINCT problem_id) n
     FROM solutions s JOIN problems p ON p.id = s.problem_id
     GROUP BY difficulty`
  ).all()
);

console.log("\ntwo-sum python solution:");
const row = db
  .prepare(
    `SELECT s.code FROM solutions s JOIN problems p ON p.id = s.problem_id
     WHERE p.slug = 'two-sum' AND s.language = 'python'`
  )
  .get();
console.log(row.code.slice(0, 400));

console.log("\nshortest/longest solutions:");
console.log(
  db.prepare(
    `SELECT p.slug, s.language, length(s.code) len
     FROM solutions s JOIN problems p ON p.id = s.problem_id
     ORDER BY len ASC LIMIT 3`
  ).all()
);
console.log(
  db.prepare(
    `SELECT p.slug, s.language, length(s.code) len
     FROM solutions s JOIN problems p ON p.id = s.problem_id
     ORDER BY len DESC LIMIT 3`
  ).all()
);

console.log("\ndescriptions loaded:",
  db.prepare(`SELECT COUNT(*) n FROM problems WHERE content_html IS NOT NULL`).get().n
);
