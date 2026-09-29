import { NextResponse } from "next/server";

import { requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { buildEpub } from "@/lib/epub";
import { loadExportArticle } from "@/lib/export-article";
import { MailError, mailConfig, sendMail } from "@/lib/mail";
import { articleFilename } from "@/lib/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mails one article to the user's Kindle.
 *
 * EPUB rather than PDF: Amazon has accepted EPUB since 2022 and reflows it, so
 * the text resizes on the device — a PDF would arrive as fixed pages. It is
 * the same file the download menu produces.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!mailConfig()) {
    return NextResponse.json(
      { error: "This app has no mail transport configured — see SMTP_* in the README" },
      { status: 503 },
    );
  }

  const settings = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { kindleEmail: true },
  });
  const to = settings?.kindleEmail?.trim();
  if (!to) {
    return NextResponse.json(
      { error: "Add your Kindle address in Settings first" },
      { status: 422 },
    );
  }

  const { id } = await ctx.params;
  const article = await loadExportArticle(id, user.userId);
  if (!article) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const epub = await buildEpub(article);
  const filename = articleFilename(article, "epub");

  try {
    await sendMail({
      to,
      // Amazon uses the subject only for its own bookkeeping; "Convert" is not
      // needed for EPUB, which it ingests directly.
      subject: article.title,
      text: `${article.title}\n${article.url}\n`,
      attachments: [
        { filename, content: epub, contentType: "application/epub+zip" },
      ],
    });
  } catch (err) {
    if (err instanceof MailError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, to, filename, bytes: epub.length });
}
