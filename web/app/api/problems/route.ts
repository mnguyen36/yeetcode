import { NextRequest, NextResponse } from "next/server";
import { listProblems } from "@/lib/db";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const language = q.get("language") ?? "python";
  const difficulty = q.get("difficulty") ?? undefined;
  return NextResponse.json(listProblems({ language, difficulty }));
}
