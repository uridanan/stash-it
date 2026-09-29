import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { Importer, instapaperToRecords } from "@/lib/backup";
import { parseInstapaperCsv } from "@/lib/instapaper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A real export of ~12k rows is about 2MB; this leaves generous headroom. */
const MAX_BYTES = 32 * 1024 * 1024;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * One-time import of an Instapaper CSV export.
 *
 * Read whole rather than streamed: quoted CSV fields may contain newlines, so
 * a line-at-a-time reader would need its own state machine for no real gain at
 * these sizes.
 *
 * Rows arrive as stubs — the export carries no article text — and the full
 * text is fetched afterwards, per article or in bulk.
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

  let parsed;
  try {
    parsed = parseInstapaperCsv(text);
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Could not read that CSV",
      422,
    );
  }

  if (parsed.rows.length === 0) {
    return jsonError("No usable rows found in that CSV", 422);
  }

  const importer = new Importer(user.userId);
  await importer.load();
  for (const record of instapaperToRecords(parsed.rows)) {
    await importer.add(record);
  }
  for (const skip of parsed.skipped.slice(0, 20)) {
    importer.note(`line ${skip.line}: ${skip.reason}`);
  }

  const summary = await importer.finish();
  return NextResponse.json({
    ...summary,
    rowsRead: parsed.rows.length,
    rowsSkipped: parsed.skipped.length,
  });
}
