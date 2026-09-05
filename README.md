# yeetcode

A typing-trainer for LeetCode solutions (like a WPM typing app, but you type
real solutions to real problems) — building recognition of problem → solution
patterns while practicing speed in your preferred language.

## Web app

`web/` is a Next.js app (TypeScript + Tailwind) serving the trainer at
`localhost:3000` via `npm run dev` (run inside `web/`). It is a fully static
build: rounds are read from pre-exported JSON in `web/public/data/`
(`web/lib/data.ts`), so there is no server or database at runtime. The typing engine
(`web/components/trainer.tsx` + `web/lib/typing.ts`) auto-skips comment
lines, blank lines, and indentation; Tab = next problem, Esc = restart.
When a round completes, the side panel's tests tab runs the problem's example
test cases in-browser (python via Pyodide, javascript/typescript via a
sandboxed Web Worker) with per-case pass/fail, runtime, and iteration counts —
see `docs/test-runner-plan.md` for the design. 509 problems are runnable;
tree/linked-list/design problems and compiled languages show their cases
statically for now.

## Static build & GitHub Pages

The app has no backend — `scripts/export-static.mjs` dumps the database to
per-language JSON bundles that the client filters in memory:

```sh
npm run export:static    # data/yeetcode.db -> web/public/data/*.json (~4 MB)
cd web && npm run build  # -> web/out/  (next.config.ts sets output: "export")
```

`web/public/data/` **is committed** (the database is not), so CI can build
without the pipeline. Descriptions live in a separate `content.json` (~1.1 MB,
lazily loaded) so that publishing them stays a one-line decision: gitignore
that file and the trainer falls back to linking out to leetcode.com, with no
code change.

`.github/workflows/pages.yml` deploys `web/out` to Pages. It is
`workflow_dispatch`-only on purpose — arm it by adding a `push` trigger.
Two things to know before enabling it:

- On the **free** plan, Pages requires the repository to be **public**.
- A Pages site is **public regardless of repository visibility**; access-controlled
  Pages requires GitHub Enterprise Cloud.

## Backend (run history)

Optional. Without it the trainer works exactly as before — `web/lib/history.ts`
treats an unreachable API as "no history", which is why the static Pages build
still works with no backend at all.

- `web/lib/schema.sql` — one `runs` table, plus indexes
- `web/lib/runs.ts` — queries via `pg`, so any Postgres works (Neon, Supabase,
  Railway, self-hosted); nothing is provider-specific
- `web/app/api/runs` — `POST` records a finished round, `GET` returns
  per-problem or overall stats
- Identity is an anonymous per-browser id in localStorage, stored in
  `runs.user_key`. **Not** an account: clearing site data starts fresh, and the
  endpoint is unauthenticated, so anyone can write runs under any key. Fine for
  personal stats; a public leaderboard would need real auth first.

```sh
cd web
DATABASE_URL='postgres://...' npm run db:migrate   # create the table
npm run db:test                                    # runs the real SQL on PGlite, no DB needed
```

### Deploying the server build to Vercel

1. Create a Postgres database (Neon's free tier is permanent and scale-to-zero).
2. Import this repo on Vercel and set **Root Directory** to `web` — the Next app
   is not at the repo root.
3. Add `DATABASE_URL` as an environment variable. On Neon use the **pooled**
   connection string (host contains `-pooler`) so serverless invocations don't
   exhaust connections.
4. Run `npm run db:migrate` once against that URL.

Note Vercel's Hobby plan is restricted to non-commercial use.

`STATIC_EXPORT=1` selects the Pages build instead; the Pages workflow sets it and
deletes `app/api` first, because Next refuses to static-export a dynamic route.

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
- LeetCode problem descriptions are copyrighted by LeetCode. They are
  published as part of the static site (`web/public/data/content.json`) — a
  deliberate call, not an accident. To stop publishing them, add that path to
  `.gitignore` and redeploy; the trainer already handles their absence by
  linking to the original problem.
- Attribution for the redistributed solution code is in
  `THIRD-PARTY-LICENSES.txt` (neetcode-gh, MIT).
