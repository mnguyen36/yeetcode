-- Run history for the typing trainer. Applied by `npm run db:migrate`.
--
-- user_key is an opaque identity string. Today it is an anonymous per-browser
-- id generated client-side (lib/device.ts); if real accounts are added later,
-- the same column holds the account id and existing rows can be reassigned.
create table if not exists runs (
  id          bigserial   primary key,
  user_key    text        not null,
  problem_id  integer     not null,
  language    text        not null,
  difficulty  text        not null,
  wpm         integer     not null check (wpm >= 0 and wpm < 1000),
  accuracy    integer     not null check (accuracy between 0 and 100),
  keystrokes  integer     not null check (keystrokes >= 0),
  misses      integer     not null check (misses >= 0),
  duration_ms integer     not null check (duration_ms > 0),
  created_at  timestamptz not null default now()
);

-- "best and attempts for this problem in this language", the hot read path.
create index if not exists runs_user_problem_idx
  on runs (user_key, problem_id, language);

-- "my recent runs" / aggregate stats.
create index if not exists runs_user_created_idx
  on runs (user_key, created_at desc);
