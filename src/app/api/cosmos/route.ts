/**
 * ChatCosmos data API
 * Serves the pre-processed galaxy dataset (public/data/cosmos-data.json).
 * The frontend fetches this once on load and performs search client-side
 * for instant filtering.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-static";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "data", "cosmos-data.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    return NextResponse.json(json, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "cosmos-data.json not found. Run the generator or Python pipeline." },
      { status: 500 }
    );
  }
}
