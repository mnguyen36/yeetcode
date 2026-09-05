// Client side of run history.
//
// The API is optional by design: the GitHub Pages build has no backend, so
// every call here fails softly and the UI simply shows no history. Point
// NEXT_PUBLIC_API_URL at a deployment to enable it, or leave it unset when the
// app and API share an origin (Vercel).

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export type ProblemStats = {
  attempts: number;
  bestWpm: number | null;
  lastWpm: number | null;
};

// Anonymous, per-browser. Not an account: it identifies a device, so clearing
// site data starts fresh and history does not follow you to another machine.
const KEY = "yeet.device";

export function deviceKey(): string {
  let k = localStorage.getItem(KEY);
  if (!k) {
    k =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(KEY, k);
  }
  return k;
}

export type RunInput = {
  problemId: number;
  language: string;
  difficulty: string;
  wpm: number;
  accuracy: number;
  keystrokes: number;
  misses: number;
  durationMs: number;
};

// Resolves to the updated stats, or null when no backend is reachable.
export async function saveRun(run: RunInput): Promise<ProblemStats | null> {
  try {
    const res = await fetch(`${API}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...run, userKey: deviceKey() }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function fetchProblemStats(
  problemId: number,
  language: string
): Promise<ProblemStats | null> {
  try {
    const params = new URLSearchParams({
      userKey: deviceKey(),
      problemId: String(problemId),
      language,
    });
    const res = await fetch(`${API}/api/runs?${params}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
