import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { looksLikeEmail, mailSender } from "@/lib/mail";
import { BUILT_IN_TOPICS } from "@/lib/taxonomy";
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROMPT,
  SUMMARY_MODELS,
} from "@/lib/summarize";

/**
 * User settings for AI summaries. The API key is write-only: GET returns
 * only whether one is stored (plus its last 4 characters as a hint) — the
 * full key is never sent back to the client.
 */

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      aiSummariesEnabled: true,
      aiModel: true,
      aiApiKey: true,
      aiPrompt: true,
      summaryView: true,
      customTopics: true,
      markReadOnListen: true,
      kindleEmail: true,
    },
  });

  return NextResponse.json({
    aiSummariesEnabled: user.aiSummariesEnabled,
    aiModel: user.aiModel,
    hasApiKey: Boolean(user.aiApiKey),
    apiKeyHint: user.aiApiKey ? user.aiApiKey.slice(-4) : null,
    aiPrompt: user.aiPrompt ?? DEFAULT_SUMMARY_PROMPT,
    aiPromptIsDefault: !user.aiPrompt,
    summaryView: user.summaryView,
    customTopics: user.customTopics,
    markReadOnListen: user.markReadOnListen,
    kindleEmail: user.kindleEmail ?? "",
    // The address Amazon has to be told to accept mail from. It comes from the
    // environment, so it is read-only here — but it has to be visible, or the
    // approval step is impossible.
    kindleSender: mailSender(),
    builtInTopics: BUILT_IN_TOPICS,
    models: SUMMARY_MODELS.map(({ id, label }) => ({ id, label })),
    defaultModel: DEFAULT_SUMMARY_MODEL,
    defaultPrompt: DEFAULT_SUMMARY_PROMPT,
  });
}

export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    aiSummariesEnabled?: boolean;
    aiModel?: string;
    aiApiKey?: string | null;
    aiPrompt?: string | null;
    summaryView?: string;
    customTopics?: string[];
    markReadOnListen?: boolean;
    kindleEmail?: string | null;
  } = {};

  if (typeof body.aiSummariesEnabled === "boolean") {
    data.aiSummariesEnabled = body.aiSummariesEnabled;
  }

  if (typeof body.aiModel === "string") {
    if (!SUMMARY_MODELS.some((m) => m.id === body.aiModel)) {
      return NextResponse.json({ error: "Unknown model" }, { status: 422 });
    }
    data.aiModel = body.aiModel;
  }

  // apiKey: omitted = unchanged, "" = clear, string = replace.
  if (typeof body.apiKey === "string") {
    data.aiApiKey = body.apiKey.trim() || null;
  }

  // prompt: matching the default (or empty) stores null so future default
  // improvements flow through to users who never customized it.
  if (typeof body.aiPrompt === "string") {
    const trimmed = body.aiPrompt.trim();
    data.aiPrompt =
      !trimmed || trimmed === DEFAULT_SUMMARY_PROMPT.trim() ? null : body.aiPrompt;
  }

  if (typeof body.summaryView === "string") {
    if (body.summaryView !== "card" && body.summaryView !== "tabs") {
      return NextResponse.json({ error: "Invalid summaryView" }, { status: 422 });
    }
    data.summaryView = body.summaryView;
  }

  if (typeof body.markReadOnListen === "boolean") {
    data.markReadOnListen = body.markReadOnListen;
  }

  // kindleEmail: omitted = unchanged, "" = clear, anything else must look like
  // an address, or a typo would fail silently later inside the mail server.
  if (typeof body.kindleEmail === "string") {
    const address = body.kindleEmail.trim();
    if (address && !looksLikeEmail(address)) {
      return NextResponse.json(
        { error: "That does not look like an email address" },
        { status: 422 },
      );
    }
    data.kindleEmail = address || null;
  }

  if (Array.isArray(body.customTopics)) {
    // Trimmed, de-duplicated case-insensitively, and capped: this list is sent
    // to the model on every classification, so it stays a short vocabulary
    // rather than growing into a prompt of its own.
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const value of body.customTopics) {
      if (typeof value !== "string") continue;
      const name = value.trim().slice(0, 40);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      // Built-ins are already offered; re-adding them would just duplicate.
      if (BUILT_IN_TOPICS.some((t) => t.toLowerCase() === key)) continue;
      seen.add(key);
      topics.push(name);
      if (topics.length === 20) break;
    }
    data.customTopics = topics;
  }

  await prisma.user.update({ where: { id: userId }, data });
  return NextResponse.json({ ok: true });
}
