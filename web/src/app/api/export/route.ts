import { createGzip } from "node:zlib";
import { Readable } from "node:stream";

import { requireUser } from "@/lib/api-auth";
import { exportRecords } from "@/lib/backup";
import { exportFilename } from "@/lib/transfer";

export const dynamic = "force-dynamic";
/** Node runtime: this uses zlib and Prisma, neither of which run on edge. */
export const runtime = "nodejs";

/**
 * Streams the whole account as gzipped NDJSON.
 *
 * Records are pushed into gzip as they come off the database rather than
 * assembled first, so memory stays flat regardless of how many articles the
 * account holds.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const now = new Date();
  const gzip = createGzip();

  void (async () => {
    try {
      for await (const line of exportRecords(user.userId, now)) {
        // Respect backpressure: without this a fast database outruns the
        // client and the buffered chunks defeat the point of streaming.
        if (!gzip.write(line)) {
          await new Promise((resolve) => gzip.once("drain", resolve));
        }
      }
      gzip.end();
    } catch (err) {
      console.error("Export failed:", err);
      gzip.destroy(err instanceof Error ? err : new Error("export failed"));
    }
  })();

  return new Response(Readable.toWeb(gzip) as ReadableStream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${exportFilename(now)}"`,
      "cache-control": "no-store",
    },
  });
}
