// Server-side run history. Postgres via node-postgres, so this works against
// Neon, Supabase, Railway or any plain Postgres — nothing here is provider
// specific. On Neon, use the *pooled* connection string (host contains
// "-pooler") so serverless invocations don't exhaust connections.
import { Pool, type QueryResultRow } from "pg";

// Serverless invocations reuse the module scope, so keep one pool per process.
const globalForPg = globalThis as unknown as { yeetPool?: Pool };

function pool(): Pool {
  if (!globalForPg.yeetPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    globalForPg.yeetPool = new Pool({ connectionString, max: 3 });
  }
  return globalForPg.yeetPool;
}

// Tests swap in an embedded Postgres (PGlite) so the SQL below is executed
// verbatim rather than re-typed in a fixture. Null restores the real pool.
export type Executor = (
  sql: string,
  params: unknown[]
) => Promise<QueryResultRow[]>;

let executor: Executor | null = null;

export function setExecutor(e: Executor | null): void {
  executor = e;
}

async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (executor) return (await executor(sql, params)) as T[];
  const res = await pool().query<T>(sql, params);
  return res.rows;
}

export type NewRun = {
  userKey: string;
  problemId: number;
  language: string;
  difficulty: string;
  wpm: number;
  accuracy: number;
  keystrokes: number;
  misses: number;
  durationMs: number;
};

export type ProblemStats = {
  attempts: number;
  bestWpm: number | null;
  lastWpm: number | null;
};

export type OverallStats = {
  attempts: number;
  problems: number;
  bestWpm: number | null;
  avgWpm: number | null;
  avgAccuracy: number | null;
};

export async function recordRun(run: NewRun): Promise<void> {
  await query(
    `insert into runs (user_key, problem_id, language, difficulty,
                       wpm, accuracy, keystrokes, misses, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      run.userKey,
      run.problemId,
      run.language,
      run.difficulty,
      run.wpm,
      run.accuracy,
      run.keystrokes,
      run.misses,
      run.durationMs,
    ]
  );
}

export async function problemStats(opts: {
  userKey: string;
  problemId: number;
  language: string;
}): Promise<ProblemStats> {
  const rows = await query<{
    attempts: string;
    best_wpm: number | null;
    last_wpm: number | null;
  }>(
    `select count(*)::text as attempts,
            max(wpm) as best_wpm,
            (array_agg(wpm order by created_at desc))[1] as last_wpm
     from runs
     where user_key = $1 and problem_id = $2 and language = $3`,
    [opts.userKey, opts.problemId, opts.language]
  );
  const r = rows[0];
  return {
    attempts: Number(r?.attempts ?? 0),
    bestWpm: r?.best_wpm ?? null,
    lastWpm: r?.last_wpm ?? null,
  };
}

export async function overallStats(userKey: string): Promise<OverallStats> {
  const rows = await query<{
    attempts: string;
    problems: string;
    best_wpm: number | null;
    avg_wpm: string | null;
    avg_accuracy: string | null;
  }>(
    `select count(*)::text                as attempts,
            count(distinct problem_id)::text as problems,
            max(wpm)                      as best_wpm,
            round(avg(wpm))::text         as avg_wpm,
            round(avg(accuracy))::text    as avg_accuracy
     from runs where user_key = $1`,
    [userKey]
  );
  const r = rows[0];
  const num = (v: string | null | undefined) => (v == null ? null : Number(v));
  return {
    attempts: Number(r?.attempts ?? 0),
    problems: Number(r?.problems ?? 0),
    bestWpm: r?.best_wpm ?? null,
    avgWpm: num(r?.avg_wpm),
    avgAccuracy: num(r?.avg_accuracy),
  };
}
