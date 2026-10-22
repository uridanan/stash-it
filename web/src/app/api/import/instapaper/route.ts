import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { CsvImportError, importInstapaperText } from "@/lib/import-csv";
import { resolveImportOptions } from "@/lib/system-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A real export of ~12k rows is about 2MB; this leaves generous headroom. */
const MAX_BYTES = 32 * 1024 * 1024;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Import of an Instapaper CSV export.
 *
 * Read whole rather than streamed: quoted CSV fields may contain newlines, so
 * a line-at-a-time reader would need its own state machine for no real gain at
 * these sizes.
 *
 * Rows arrive as stubs — the export carries no article text — and the full
 * text is fetched afterwards, per article or in bulk.
 *
 * Read/unread and star always come from the Folder column. Star is never
 * derived. The collections option only decides whether a *new* row takes the
 * file's tags or leaves them for automatic assignment. A URL already saved is
 * not duplicated and its collections are left as they are; read/unread and
 * star are updated from the file.
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) return jsonError("The file is empty", 400);
  if (body.byteLength > MAX_BYTES) {
    return jsonError("That file is larger than this import supports", 413);
  }

  const text = new TextDecoder("utf-8").decode(body);
  const options = await resolveImportOptions(user.userId, {
    tags: new URL(req.url).searchParams.get("tags"),
  });

  try {
    const summary = await importInstapaperText(user.userId, text, options.tags);
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof CsvImportError) return jsonError(err.message, 422);
    return jsonError(
      err instanceof Error ? err.message : "Could not read that CSV",
      422,
    );
  }
}
