import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true, service: "openlaunch-web", timestamp: new Date().toISOString() });
}