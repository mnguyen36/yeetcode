# Plan: run test cases after a round completes

Goal: when the user finishes typing a solution, the side panel flips to a
"tests" view and the problem's example test cases execute one by one — each
case visibly running (spinner → pass/fail), with runtime and an execution
step counter ("iterations") per case.

## What we already have

- `data/raw/content/<slug>.json` already stores `exampleTestcases` (raw input
  lines, e.g. `"[1,0,0,0,1]\n1"`) for all 654 fetched problems — not yet in
  the DB.
- The typed code is a known-good solution, so runs should almost always go
  green — the run is a payoff moment, not a judge.

## Phase 1 — data: signatures + expected outputs

1. Extend `fetch-content.mjs` to also request `question.metaData` from the
   LeetCode GraphQL API. It's JSON describing the entry point:
   `{ "name": "canPlaceFlowers", "params": [...], "return": {...} }`.
   Needed to know which function to call and how many args each case takes.
2. Parse expected outputs from the stored description HTML: every example
   block has `Input:` / `Output:` lines in a `<pre>`. Regex-extract and pair
   with `exampleTestcases` chunks.
3. New DB table:
   `testcases(problem_id, ordinal, args_json, expected_json)` plus
   `problems.meta_json`. Rebuild via `build-db.mjs`; API returns them with
   the round.
4. Not every problem parses cleanly (design problems like `MyHashSet` use
   call-sequence format; linked-list/tree args need deserializers). Track a
   `runnable` flag per problem; the UI only offers runs when true. Tree/list
   codecs (`[1,null,2]` → TreeNode) come later and flip more problems on.

## Phase 2 — JS/TS runner (native, no downloads)

- Execute in a sandboxed **Web Worker** (no DOM, terminated on timeout).
- Harness: `new Function` over the typed solution + a shim that JSON-parses
  args, invokes the entry function (or `new Solution().method(...)`),
  deep-compares result vs expected (order-insensitive option for
  "any order" problems later).
- TypeScript: strip types with a lightweight transpiler (sucrase) in the
  worker before eval.
- **Iterations counter**: instrument the source before eval — inject a
  `__step()` call into every loop body and function entry (regex/acorn walk),
  where `__step` increments a counter and every ~10k steps posts progress to
  the UI and checks a step budget (kills runaway loops). This gives the
  live-ticking "iterations" number per case.

## Phase 3 — Python runner (Pyodide)

- Lazy-load Pyodide (~6 MB WASM) in a worker the first time a Python round
  finishes; cache aggressively; show "warming up python…" state.
- Same harness idea: parse args from JSON (LeetCode arg syntax is JSON-compatible),
  call `Solution().method(*args)`, compare.
- Iterations via `sys.settrace` line-event counting (cheap enough for example
  inputs; also enforces the step budget).

## Phase 4 — UI

- Side panel becomes tabbed: `problem | tests`. Manual switch any time;
  auto-switch on completion.
- Each case: row with ordinal, args preview, live step counter while running,
  then ✓/✗, elapsed ms, steps, and expected-vs-got diff on failure.
- Cases run sequentially (worker queue) so the cascade reads as a moment;
  results summary chip (`3/3 passed`) lands next to the WPM card.
- Languages without a runner (java, go, …): panel shows the cases statically
  with a "runs in-browser for python/js/ts only (for now)" note.

## Order of work

1. Phase 1 (pipeline + DB + API) — unblocks everything, pure data work.
2. Phase 2 JS runner end-to-end for array/string/number problems.
3. Phase 4 UI with JS only.
4. Phase 3 Pyodide.
5. Tree/linked-list codecs, then server-side sandbox (Judge0/Piston) as the
   long-term path for compiled languages.
