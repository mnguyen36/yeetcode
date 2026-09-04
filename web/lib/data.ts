// Client-side data access for the static build.
//
// Replaces the old /api/* routes: instead of querying SQLite on a server, the
// whole per-language round set is fetched once and filtered in memory. Bundles
// are ~250-600 KB each and only the active language is ever loaded.

export type Testcase = { argsJson: string; expectedJson: string };

export type Round = {
  id: number;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  language: string;
  code: string;
  fnName: string | null;
  runnable: boolean;
  testcases: Testcase[];
};

export type Listing = {
  id: number;
  title: string;
  slug: string;
  difficulty: Round["difficulty"];
  runnable: boolean;
};

export type Meta = {
  languages: { language: string; problems: number }[];
  difficulties: string[];
};

// basePath isn't applied to fetch() by Next, so prefix it ourselves.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let metaPromise: Promise<Meta> | null = null;
const langCache = new Map<string, Promise<Round[]>>();

export function fetchMeta(): Promise<Meta> {
  if (!metaPromise) {
    metaPromise = fetch(`${BASE}/data/meta.json`).then((r) => {
      if (!r.ok) throw new Error("meta unavailable");
      return r.json();
    });
    // don't cache a rejection forever
    metaPromise.catch(() => {
      metaPromise = null;
    });
  }
  return metaPromise;
}

function loadLanguage(language: string): Promise<Round[]> {
  let p = langCache.get(language);
  if (!p) {
    p = fetch(`${BASE}/data/lang-${language}.json`).then((r) =>
      r.ok ? r.json() : []
    );
    p.catch(() => langCache.delete(language));
    langCache.set(language, p);
  }
  return p;
}

function matching(rounds: Round[], difficulty?: string): Round[] {
  return difficulty ? rounds.filter((r) => r.difficulty === difficulty) : rounds;
}

export async function listProblems(opts: {
  language: string;
  difficulty?: string;
}): Promise<Listing[]> {
  const rounds = matching(await loadLanguage(opts.language), opts.difficulty);
  return rounds.map(({ id, title, slug, difficulty, runnable }) => ({
    id,
    title,
    slug,
    difficulty,
    runnable,
  }));
}

export async function randomRound(opts: {
  language: string;
  difficulty?: string;
  excludeId?: number;
}): Promise<Round | null> {
  const pool = matching(await loadLanguage(opts.language), opts.difficulty);
  const pick = opts.excludeId
    ? pool.filter((r) => r.id !== opts.excludeId)
    : pool;
  // excluding the current round can empty a one-problem pool; fall back to it
  const from = pick.length ? pick : pool;
  if (!from.length) return null;
  return from[Math.floor(Math.random() * from.length)];
}

export async function problemRound(opts: {
  id: number;
  language: string;
}): Promise<Round | null> {
  const rounds = await loadLanguage(opts.language);
  return rounds.find((r) => r.id === opts.id) ?? null;
}
