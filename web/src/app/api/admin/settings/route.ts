import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { looksLikeEmail, mailAccountView } from "@/lib/mail";
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROMPT,
  SUMMARY_MODELS,
} from "@/lib/summarize";
import {
  asContentChoice,
  asSummaryChoice,
  asTagsChoice,
  getSystemSettings,
  requireAdmin,
} from "@/lib/system-settings";
import { MAX_DEFAULT_TOPICS, normalizeTopicNames } from "@/lib/taxonomy";

/**
 * System settings. The API key is write-only: GET returns whether one is
 * stored and its last 4 characters, never the key itself.
 */

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonError("Forbidden", 403);

  const system = await getSystemSettings();
  const mail = mailAccountView(system);
  return NextResponse.json({
    aiModel: system.aiModel,
    hasApiKey: Boolean(system.aiApiKey),
    apiKeyHint: system.aiApiKey ? system.aiApiKey.slice(-4) : null,
    aiPrompt: system.aiPrompt ?? DEFAULT_SUMMARY_PROMPT,
    aiPromptIsDefault: !system.aiPrompt,
    defaultPrompt: DEFAULT_SUMMARY_PROMPT,
    defaultModel: DEFAULT_SUMMARY_MODEL,
    models: SUMMARY_MODELS.map(({ id, label }) => ({ id, label })),
    defaultTopics: system.defaultTopics,
    importTags: asTagsChoice(system.importTags) ?? "assign",
    importContent: asContentChoice(system.importContent),
    importSummary: asSummaryChoice(system.importSummary),
    // The account actually used to send, saved here or taken from the
    // environment. The password is included so Admin can reveal it; this
    // route is admin-only and must not log the body.
    smtpFrom: mail.from,
    smtpHost: mail.host,
    smtpPort: mail.port,
    smtpUser: mail.user,
    smtpPassword: mail.password,
    smtpSource: mail.source,
  });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return jsonError("Forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const data: {
    aiModel?: string;
    aiApiKey?: string | null;
    aiPrompt?: string | null;
    defaultTopics?: string[];
    importTags?: string;
    importContent?: string;
    importSummary?: string;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpUser?: string | null;
    smtpPassword?: string | null;
    smtpFrom?: string | null;
  } = {};

  if (typeof body.aiModel === "string") {
    if (!SUMMARY_MODELS.some((model) => model.id === body.aiModel)) {
      return jsonError("Unknown model", 422);
    }
    data.aiModel = body.aiModel;
  }

  // apiKey: omitted = unchanged, "" = clear, string = replace.
  if (typeof body.apiKey === "string") {
    data.aiApiKey = body.apiKey.trim() || null;
  }

  // Matching the default (or empty) stores null, so a later default still
  // reaches an installation that never customized the prompt.
  if (typeof body.aiPrompt === "string") {
    const trimmed = body.aiPrompt.trim();
    data.aiPrompt =
      !trimmed || trimmed === DEFAULT_SUMMARY_PROMPT.trim() ? null : body.aiPrompt;
  }

  if (Array.isArray(body.defaultTopics)) {
    data.defaultTopics = normalizeTopicNames(body.defaultTopics, MAX_DEFAULT_TOPICS);
  }

  const tags = asTagsChoice(body.importTags);
  if (tags) data.importTags = tags;

  if (body.importContent === "missing" || body.importContent === "refresh") {
    data.importContent = body.importContent;
  }

  if (
    body.importSummary === "ondemand" ||
    body.importSummary === "missing" ||
    body.importSummary === "always"
  ) {
    data.importSummary = body.importSummary;
  }

  if (typeof body.smtpFrom === "string") {
    const from = body.smtpFrom.trim();
    if (!from) {
      data.smtpFrom = null;
      data.smtpHost = null;
      data.smtpPort = null;
      data.smtpUser = null;
      data.smtpPassword = null;
    } else {
      if (!looksLikeEmail(from)) return jsonError("Enter an email address", 422);
      const host = typeof body.smtpHost === "string" ? body.smtpHost.trim() : "";
      if (!host) return jsonError("Enter the SMTP host", 422);
      const port =
        body.smtpPort === undefined || body.smtpPort === null || body.smtpPort === ""
          ? 587
          : Number(body.smtpPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return jsonError("Enter a port between 1 and 65535", 422);
      }
      data.smtpFrom = from;
      data.smtpHost = host;
      data.smtpPort = port;
      data.smtpUser =
        typeof body.smtpUser === "string" && body.smtpUser.trim()
          ? body.smtpUser.trim()
          : null;
      // Omitted keeps the saved password. "" clears it.
      if (typeof body.smtpPassword === "string") {
        data.smtpPassword = body.smtpPassword.trim() || null;
      }
    }
  }

  await getSystemSettings();
  await prisma.systemSettings.update({ where: { id: "system" }, data });
  return NextResponse.json({ ok: true });
}
