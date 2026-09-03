import { NextRequest, NextResponse } from "next/server";
import { randomRound } from "@/lib/db";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const language = q.get("language") ?? "python";
  const difficulty = q.get("difficulty") ?? undefined;
  const excludeId = q.get("exclude") ? Number(q.get("exclude")) : undefined;

  const round = randomRound({ language, difficulty, excludeId });
  if (!round) {
    return NextResponse.json(
      { error: "No problems match those filters." },
      { status: 404 }
    );
  }
  return NextResponse.json(round);
}
