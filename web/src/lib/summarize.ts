import Anthropic from "@anthropic-ai/sdk";

import {
  AI_REQUEST_TIMEOUT_MS,
  postJson,
  toProviderError,
} from "@/lib/ai-provider";

/**
 * AI article summaries. The user picks a model, supplies their own API key,
 * and may edit the prompt — all stored on the User row (see /settings).
 * Providers: Anthropic (official SDK), Google Gemini and xAI Grok (REST).
 */

export const DEFAULT_SUMMARY_PROMPT = `You summarize saved articles for a read-it-later app. Always write in English, regardless of the article's language. The whole summary must be at most 10 lines.

Use exactly this format:

THE NEWS
<2-3 sentences: what happened, who is involved, and when>

KEY INSIGHTS
- <an insight stated by the article, with its supporting evidence or figures from the article>
- <another stated insight — 3 to 5 bullets total>

Rules:
- Report only insights and conclusions the article itself states. Do not add your own analysis or inferences.
- Keep names, figures, and dates exactly as the article gives them.
- If the link points to a video, start THE NEWS with "Video:". When the video itself is provided to you, extract its transcript and summarize the video's spoken content using this same format. Otherwise use any transcript, captions, or description text on the page.
- If the text is too thin to summarize, say what the page appears to be about and note that little content was available. Never invent details.`;

export interface SummaryModel {
  id: string;
  label: string;
  provider: "anthropic" | "gemini" | "grok";
}

export const SUMMARY_MODELS: SummaryModel[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "gemini" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "gemini" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (cheapest)", provider: "gemini" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheap)", provider: "anthropic" },
  { id: "grok-4.5", label: "Grok 4.5", provider: "grok" },
  { id: "grok-4.3", label: "Grok 4.3 (cheap)", provider: "grok" },
];

export const DEFAULT_SUMMARY_MODEL = "gemini-3.1-pro-preview";

/** Max article characters sent to the model (~15k tokens). */
const MAX_ARTICLE_CHARS = 60_000;

export class SummaryError extends Error {}

export interface SummaryInput {
  title: string;
  url: string;
  siteName: string | null;
  /** Sanitized article HTML (Article.content). */
  content: string;
}

export interface SummarySettings {
  model: string;
  apiKey: string;
  /** null/empty → DEFAULT_SUMMARY_PROMPT */
  prompt: string | null;
}

/** Crude HTML → text: good enough for sanitized article markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildUserMessage(input: SummaryInput): string {
  const text = htmlToText(input.content).slice(0, MAX_ARTICLE_CHARS);
  return [
    `Title: ${input.title}`,
    input.siteName ? `Source: ${input.siteName}` : null,
    `URL: ${input.url}`,
    "",
    "Article text:",
    text || "(no readable text was extracted from this page)",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function generateSummary(
  input: SummaryInput,
  settings: SummarySettings,
): Promise<string> {
  const model = SUMMARY_MODELS.find((m) => m.id === settings.model);
  if (!model) {
    throw new SummaryError(`Unknown summary model: ${settings.model}`);
  }
  if (!settings.apiKey) {
    throw new SummaryError("No API key configured for AI summaries");
  }

  const prompt = settings.prompt?.trim() || DEFAULT_SUMMARY_PROMPT;
  const userMessage = buildUserMessage(input);

  let summary: string;
  switch (model.provider) {
    case "anthropic":
      summary = await summarizeWithAnthropic(model.id, settings.apiKey, prompt, userMessage);
      break;
    case "gemini":
      summary = await summarizeWithGemini(
        model.id,
        settings.apiKey,
        prompt,
        userMessage,
        // Gemini can ingest YouTube videos directly — the model reads the
        // actual video/transcript instead of just the page text.
        youtubeUrl(input.url),
      );
      break;
    case "grok":
      summary = await summarizeWithGrok(model.id, settings.apiKey, prompt, userMessage);
      break;
  }

  summary = summary.trim();
  if (!summary) throw new SummaryError("The model returned an empty summary");
  return summary;
}

async function summarizeWithAnthropic(
  modelId: string,
  apiKey: string,
  prompt: string,
  userMessage: string,
): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: AI_REQUEST_TIMEOUT_MS });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: modelId,
      max_tokens: 1024, // deliberately short output: ≤10-line summary
      system: prompt,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    throw toProviderError("Anthropic", err, SummaryError);
  }
  if (response.stop_reason === "refusal") {
    throw new SummaryError("Anthropic: the model declined to summarize this article");
  }
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Returns a normalized YouTube watch URL when the link is a YouTube video. */
export function youtubeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be" && parsed.pathname.length > 1) {
      return `https://www.youtube.com/watch?v=${parsed.pathname.slice(1)}`;
    }
    if (host === "youtube.com") {
      if (parsed.pathname === "/watch" && parsed.searchParams.get("v")) {
        return `https://www.youtube.com/watch?v=${parsed.searchParams.get("v")}`;
      }
      const short = parsed.pathname.match(/^\/(shorts|live)\/([\w-]+)/);
      if (short) return `https://www.youtube.com/watch?v=${short[2]}`;
    }
  } catch {
    // Not a valid URL — no video to attach.
  }
  return null;
}

async function summarizeWithGemini(
  modelId: string,
  apiKey: string,
  prompt: string,
  userMessage: string,
  videoUrl: string | null,
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: userMessage }];
  if (videoUrl) {
    parts.push({ file_data: { file_uri: videoUrl } });
  }
  const res = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: 2048 },
    },
    "Gemini",
    SummaryError,
  );
  const responseParts: Array<{ text?: string }> =
    res?.candidates?.[0]?.content?.parts ?? [];
  return responseParts.map((p) => p.text ?? "").join("");
}

async function summarizeWithGrok(
  modelId: string,
  apiKey: string,
  prompt: string,
  userMessage: string,
): Promise<string> {
  const res = await postJson(
    "https://api.x.ai/v1/chat/completions",
    { authorization: `Bearer ${apiKey}` },
    {
      model: modelId,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
    },
    "Grok",
    SummaryError,
  );
  return res?.choices?.[0]?.message?.content ?? "";
}
