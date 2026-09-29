import { requireUser } from "@/lib/api-auth";
import { packArchive } from "@/lib/archive";
import { exportArchiveEntries } from "@/lib/backup-archive";
import { getTagBySlug } from "@/lib/tags";
import { archiveFilename } from "@/lib/transfer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Full backup as a tar.gz: stash.json, links.ndjson and one HTML file per
 * article.
 *
 * `?content=exclude` omits the article bodies, for a small structure-only
 * export that still restores every link, collection and reading state.
 * `?tag=<slug>` narrows the whole archive to one collection.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const params = new URL(req.url).searchParams;
  const includeContent = params.get("content") !== "exclude";
  const slug = params.get("tag");
  const tag = slug ? await getTagBySlug(user.userId, slug) : null;
  if (slug && !tag) {
    return new Response(JSON.stringify({ error: "No such collection" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const now = new Date();

  const stream = packArchive(
    exportArchiveEntries(user.userId, now, { includeContent, tagId: tag?.id }),
    (err) => console.error("Archive export failed:", err),
  );

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${archiveFilename(now, includeContent, tag?.slug)}"`,
      "cache-control": "no-store",
    },
  });
}
