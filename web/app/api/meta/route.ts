import { NextResponse } from "next/server";
import { meta } from "@/lib/db";

export function GET() {
  return NextResponse.json(meta());
}
