import { NextRequest, NextResponse } from "next/server";
import { problemRound } from "@/lib/db";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const id = Number(q.get("id"));
  const language = q.get("language") ?? "python";
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a problem number" }, { status: 400 });
  }
  const round = problemRound({ id, language });
  if (!round) {
    return NextResponse.json(
      { error: `No ${language} solution for problem ${id}.` },
      { status: 404 }
    );
  }
  return NextResponse.json(round);
}
