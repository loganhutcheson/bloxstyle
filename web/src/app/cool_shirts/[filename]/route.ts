import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function getContentType(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(_req: Request, { params }: any) {
  try {
    const unsafeName = params.filename || "";
    const safeName = path.basename(unsafeName);
    const ext = path.extname(safeName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new NextResponse("Unsupported file type", { status: 400 });
    }

    const baseDir = path.join(process.cwd(), "cool_shirts");
    const fullPath = path.join(baseDir, safeName);

    const fileInfo = await stat(fullPath).catch(() => null);
    if (!fileInfo || !fileInfo.isFile()) {
      return new NextResponse("Not found", { status: 404 });
    }

    const fileBuffer = await readFile(fullPath);
    const bytes = new Uint8Array(fileBuffer);
    const headers = new Headers();
    headers.set("Content-Type", getContentType(ext));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(bytes, { status: 200, headers });
  } catch {
    return new NextResponse("Server error", { status: 500 });
  }
}


