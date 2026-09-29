import Anthropic from "@anthropic-ai/sdk";

import {
  AI_REQUEST_TIMEOUT_MS,
  postJson,
  toProviderError,
} from "@/lib/ai-provider";
import { htmlToText, SUMMARY_MODELS } from "@/lib/summarize";
import { MAX_TOPICS_PER_ARTICLE, topicVocabulary } from "@/lib/taxonomy";

/**
 * AI topic classification: picks topics for an article from a fixed vocabulary.
 *
 * Uses the same BYO key and model as summaries, and runs from the same
 * background job — so it costs one extra cheap call per save and needs no
 * additional configuration.
 *
 * The prompt here is fixed, deliberately *not* the user-editable summary
 * prompt: parsing depends on the response shape, and a user rewriting their
 * summary prompt must not silently break topic tagging.
 */

export class ClassifyError extends Error {}

/** Article text is truncated hard — topics come from the opening, not the tail. */
const MAX_CLASSIFY_CHARS = 12_000;

export interface ClassifyInput {
  title: string;
  url: string;
  siteName: string | null;
  /** Sanitized article HTML (Article.content). */
  content: string;
}

export interface ClassifySettings {
  model: string;
  apiKey: string;
  /** Extra topic names beyond the built-in taxonomy. */
  customTopics: readonly string[];
}

function buildPrompt(vocabulary: readonly string[]): string {
  return [
    "You label saved articles with topics for a read-it-later app.",
    "",
    "Choose only from this list of topics:",
    vocabulary.join(", "),
    "",
    "Rules:",
    `- Pick between 1 and ${MAX_TOPICS_PER_ARTICLE} topics, most relevant first.`,
    "- Use only topics from the list, spelled exactly as given.",
    "- If nothing fits well, return an empty array.",
    "- Judge the article's subject, not the website it came from.",
    "",
    'Reply with a JSON array of strings and nothing else, e.g. ["Technology","Business"].',
  ].join("\n");
}

function buildUserMessage(input: ClassifyInput): string {
  const text = htmlToText(input.content).slice(0, MAX_CLASSIFY_CHARS);
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

/**
 * Pulls the topic list out of a model response.
 *
 * Tolerant by design: models wrap JSON in prose or code fences often enough
 * that being strict here would mean losing tags for no reason. Anything not in
 * the vocabulary is dropped, so a hallucinated topic can never create a tag.
 */
export function parseTopics(
  raw: string,
  vocabulary: readonly string[],
): string[] {
  const canonical = new Map(vocabulary.map((t) => [t.toLowerCase(), t]));

  let values: unknown[] = [];
  const match = raw.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      // Fall through to the line-based reading below.
    }
  }

  if (values.length === 0) {
    // No usable JSON: treat the response as a comma/newline separated list.
    values = raw
      .replace(/```[a-z]*|```/gi, "")
      .split(/[,\n]/)
      .map((part) => part.replace(/^[\s\-*"'[\]]+|[\s"'[\]]+$/g, ""));
  }

  const topics: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const hit = canonical.get(value.trim().toLowerCase());
    if (hit && !topics.includes(hit)) topics.push(hit);
    if (topics.length === MAX_TOPICS_PER_ARTICLE) break;
  }
  return topics;
}

export async function classifyTopics(
  input: ClassifyInput,
  settings: ClassifySettings,
): Promise<string[]> {
  const model = SUMMARY_MODELS.find((m) => m.id === settings.model);
  if (!model) throw new ClassifyError(`Unknown model: ${settings.model}`);
  if (!settings.apiKey) throw new ClassifyError("No API key configured");

  const vocabulary = topicVocabulary(settings.customTopics);
  const prompt = buildPrompt(vocabulary);
  const userMessage = buildUserMessage(input);

  let raw: string;
  switch (model.provider) {
    case "anthropic":
      raw = await classifyWithAnthropic(model.id, settings.apiKey, prompt, userMessage);
      break;
    case "gemini":
      raw = await classifyWithGemini(model.id, settings.apiKey, prompt, userMessage);
      break;
    case "grok":
      raw = await classifyWithGrok(model.id, settings.apiKey, prompt, userMessage);
      break;
  }

  return parseTopics(raw, vocabulary);
}

/** Topic lists are tiny; cap output so a runaway response can't cost real money. */
const MAX_OUTPUT_TOKENS = 128;

async function classifyWithAnthropic(
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
      max_tokens: MAX_OUTPUT_TOKENS,
      system: prompt,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    throw toProviderError("Anthropic", err, ClassifyError);
  }
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function classifyWithGemini(
  modelId: string,
  apiKey: string,
  prompt: string,
  userMessage: string,
): Promise<string> {
  const res = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    },
    "Gemini",
    ClassifyError,
  );
  const parts: Array<{ text?: string }> =
    res?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

async function classifyWithGrok(
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
      max_tokens: MAX_OUTPUT_TOKENS,
    },
    "Grok",
    ClassifyError,
  );
  return res?.choices?.[0]?.message?.content ?? "";
}
