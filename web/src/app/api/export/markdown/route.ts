import { requireUser } from "@/lib/api-auth";
import { packArchive } from "@/lib/archive";
import { exportMarkdownEntries } from "@/lib/backup-archive";
import { getTagBySlug } from "@/lib/tags";
import { markdownFilename } from "@/lib/transfer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The readable Markdown export: one .md per article plus an index.
 *
 * One-way by design — unpack it into a notes app and read. The restore
 * artefact is the archive from /api/export/archive, which keeps the article
 * HTML exactly as stored. `?tag=<slug>` narrows it to one collection.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const slug = new URL(req.url).searchParams.get("tag");
  const tag = slug ? await getTagBySlug(user.userId, slug) : null;
  if (slug && !tag) {
    return new Response(JSON.stringify({ error: "No such collection" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const now = new Date();
  const stream = packArchive(
    exportMarkdownEntries(user.userId, now, { tagId: tag?.id }),
    (err) => console.error("Markdown export failed:", err),
  );

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${markdownFilename(now, tag?.slug)}"`,
      "cache-control": "no-store",
    },
  });
}
