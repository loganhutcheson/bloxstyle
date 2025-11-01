import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export async function GET() {
  try {
    const baseDir = path.join(process.cwd(), "cool_shirts");
    const entries = await readdir(baseDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ files: [], error: "Unable to read images" }, { status: 500 });
  }
}


