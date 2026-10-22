import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { looksLikeEmail, resolveMailConfig } from "@/lib/mail";
import {
  asTagsChoice,
  getSystemSettings,
} from "@/lib/system-settings";
import {
  MAX_CUSTOM_TOPICS,
  normalizeTopicNames,
  splitTopicList,
  topicVocabulary,
} from "@/lib/taxonomy";

/**
 * One person's settings.
 *
 * The model, key, and prompt are system settings, so this route neither
 * reads nor writes them. `hasApiKey` reports whether the system has one,
 * which is all the reader needs in order to offer Summarize.
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

  const [user, system] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        aiSummariesEnabled: true,
        summaryView: true,
        customTopics: true,
        excludedTopics: true,
        importTagsOverride: true,
        markReadOnListen: true,
        kindleEmail: true,
      },
    }),
    getSystemSettings(),
  ]);

  const override = asTagsChoice(user.importTagsOverride);
  const systemTags = asTagsChoice(system.importTags) ?? "assign";

  return NextResponse.json({
    aiSummariesEnabled: user.aiSummariesEnabled,
    hasApiKey: Boolean(system.aiApiKey),
    summaryView: user.summaryView,
    customTopics: user.customTopics,
    excludedTopics: user.excludedTopics,
    defaultTopics: system.defaultTopics,
    topics: topicVocabulary(user.customTopics ?? [], {
      base: system.defaultTopics ?? [],
      excluded: user.excludedTopics ?? [],
    }),
    importTags: override ?? systemTags,
    importTagsOverride: override,
    systemImportTags: systemTags,
    markReadOnListen: user.markReadOnListen,
    kindleEmail: user.kindleEmail ?? "",
    // The address Amazon has to be told to accept mail from. Admin sets the
    // account; this is read-only here, but it has to be visible.
    kindleSender: resolveMailConfig(system)?.from ?? null,
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
    summaryView?: string;
    customTopics?: string[];
    excludedTopics?: string[];
    importTagsOverride?: string | null;
    markReadOnListen?: boolean;
    kindleEmail?: string | null;
  } = {};

  if (typeof body.aiSummariesEnabled === "boolean") {
    data.aiSummariesEnabled = body.aiSummariesEnabled;
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

  // The edited list: defaults they kept, plus tags they added. Stored as
  // removals and additions so a default added later still appears.
  if (Array.isArray(body.topics)) {
    const system = await getSystemSettings();
    const wanted = normalizeTopicNames(body.topics, system.defaultTopics.length + MAX_CUSTOM_TOPICS);
    const split = splitTopicList(wanted, system.defaultTopics);
    data.excludedTopics = split.excludedTopics;
    data.customTopics = split.customTopics;
  } else if (Array.isArray(body.customTopics)) {
    data.customTopics = normalizeTopicNames(body.customTopics, MAX_CUSTOM_TOPICS);
  }

  if (body.importTagsOverride === null) {
    data.importTagsOverride = null;
  } else {
    const choice = asTagsChoice(body.importTagsOverride);
    if (choice) data.importTagsOverride = choice;
  }

  await prisma.user.update({ where: { id: userId }, data });
  return NextResponse.json({ ok: true });
}
