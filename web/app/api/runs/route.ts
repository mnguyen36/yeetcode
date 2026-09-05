import { NextRequest, NextResponse } from "next/server";
import { overallStats, problemStats, recordRun } from "@/lib/runs";

// pg needs the Node runtime, and these routes are per-user so never prerender.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint is unauthenticated: user_key is a client-generated id, so a
// determined caller can write runs under any key. That is acceptable for
// personal stats and would NOT be acceptable for a public leaderboard —
// adding one means adding real auth first. Validation here is about keeping
// junk out of the table, not about trust.
const LANGUAGES = new Set([
  "c", "cpp", "csharp", "dart", "go", "java", "javascript", "kotlin",
  "python", "ruby", "rust", "scala", "swift", "typescript",
]);
const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function userKey(v: unknown): string | null {
  return typeof v === "string" && v.length >= 8 && v.length <= 64 ? v : null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const key = userKey(body.userKey);
  const problemId = int(body.problemId, 1, 100_000);
  const language = String(body.language ?? "");
  const difficulty = String(body.difficulty ?? "");
  const wpm = int(body.wpm, 0, 999);
  const accuracy = int(body.accuracy, 0, 100);
  const keystrokes = int(body.keystrokes, 0, 1_000_000);
  const misses = int(body.misses, 0, 1_000_000);
  const durationMs = int(body.durationMs, 1, 24 * 60 * 60 * 1000);

  if (
    !key || problemId === null || !LANGUAGES.has(language) ||
    !DIFFICULTIES.has(difficulty) || wpm === null || accuracy === null ||
    keystrokes === null || misses === null || durationMs === null
  ) {
    return NextResponse.json({ error: "invalid run" }, { status: 400 });
  }

  try {
    await recordRun({
      userKey: key, problemId, language, difficulty,
      wpm, accuracy, keystrokes, misses, durationMs,
    });
    return NextResponse.json(
      await problemStats({ userKey: key, problemId, language })
    );
  } catch (err) {
    console.error("recordRun failed", err);
    return NextResponse.json({ error: "could not save run" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const key = userKey(q.get("userKey"));
  if (!key) {
    return NextResponse.json({ error: "userKey required" }, { status: 400 });
  }

  try {
    const problemId = q.get("problemId");
    if (problemId) {
      const id = int(problemId, 1, 100_000);
      const language = String(q.get("language") ?? "");
      if (id === null || !LANGUAGES.has(language)) {
        return NextResponse.json({ error: "invalid query" }, { status: 400 });
      }
      return NextResponse.json(
        await problemStats({ userKey: key, problemId: id, language })
      );
    }
    return NextResponse.json(await overallStats(key));
  } catch (err) {
    console.error("stats query failed", err);
    return NextResponse.json({ error: "could not load stats" }, { status: 500 });
  }
}
