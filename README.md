# yeetcode

A typing-trainer for LeetCode solutions (like a WPM typing app, but you type
real solutions to real problems) — building recognition of problem → solution
patterns while practicing speed in your preferred language.

## Web app

`web/` is a Next.js app (TypeScript + Tailwind) serving the trainer at
`localhost:3000` via `npm run dev` (run inside `web/`). It reads
`data/yeetcode.db` directly (`web/lib/db.ts`). The typing engine
(`web/components/trainer.tsx` + `web/lib/typing.ts`) auto-skips comment
lines, blank lines, and indentation; Tab = next problem, Esc = restart.
When a round completes, the side panel's tests tab runs the problem's example
test cases in-browser (python via Pyodide, javascript/typescript via a
sandboxed Web Worker) with per-case pass/fail, runtime, and iteration counts —
see `docs/test-runner-plan.md` for the design. 509 problems are runnable;
tree/linked-list/design problems and compiled languages show their cases
statically for now.

## Data pipeline

Everything lives in a single SQLite database at `data/yeetcode.db`, built from
free sources:

| Source | What we take | License / terms |
| --- | --- | --- |
| LeetCode GraphQL API | Problem metadata (id, title, slug, difficulty, tags, acceptance rate) and question descriptions for free problems | Publicly served; descriptions are LeetCode content — review before publishing them on a public site |
| [neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode) | Solutions in 14 languages for ~670 curated problems | MIT |

### Rebuilding from scratch

```sh
npm install
git clone --depth 1 https://github.com/neetcode-gh/leetcode.git data/raw/neetcode
npm run fetch:problems   # problem list + tags  -> data/raw/problems.json
npm run fetch:content    # descriptions (resumable, throttled) -> data/raw/content/
npm run build:db         # -> data/yeetcode.db (idempotent, run after any fetch)
```

### Schema

- `problems` — one row per LeetCode problem (`id` = frontend question id,
  `slug`, `title`, `difficulty`, `paid_only`, `ac_rate`, `content_html`,
  `hints_json`, `source`)
- `solutions` — one row per (problem, language, source); `code`, `source_path`,
  `license`
- `tags` / `problem_tags` — topic tags (arrays, dynamic-programming, ...)

### Notes

- Solution coverage: ~670 problems, ~3,700 solutions. Languages: python,
  javascript, typescript, java, kotlin, cpp, c, csharp, go, rust, swift, ruby,
  scala, dart.
- `data/raw/` is disposable cache; the DB is rebuilt from it deterministically.
- LeetCode problem descriptions are copyrighted by LeetCode. Storing them
  locally for development is one thing; serving them verbatim from a public
  yeetcode.com needs a decision (rewrite/summarize them, or link out to the
  original problem).
