import { prisma } from "@/lib/db";
import { classifyTopics } from "@/lib/classify";
import { generateSummary } from "@/lib/summarize";
import { getSystemSettings } from "@/lib/system-settings";
import { attachTags, ensureTags } from "@/lib/tags";
import { topicVocabulary } from "@/lib/taxonomy";

/**
 * The two AI tasks, each standalone.
 *
 * They used to be one: classification ran inside the summary job, after the
 * summary succeeded. Nothing about the data required that — `ClassifyInput`
 * reads the article's content, never its summary — and the coupling meant
 * topics could only ever arrive by paying for a summary too.
 *
 * Separating them matters at import scale. Classification truncates input at
 * 12k characters and caps output at 128 tokens; a summary reads up to 60k and
 * writes up to 1024. Running classification over a whole library populates
 * collections for a fraction of what summarising the same library costs, which
 * is why summaries can default to on-demand without leaving collections empty.
 */

export interface AiSettings {
  aiSummariesEnabled: boolean;
  aiModel: string;
  aiApiKey: string | null;
  aiPrompt: string | null;
  /** Defaults, minus this person's removals, plus their additions. */
  topics: string[];
}

export async function loadAiSettings(userId: string): Promise<AiSettings | null> {
  const [settings, system] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        aiSummariesEnabled: true,
        customTopics: true,
        excludedTopics: true,
      },
    }),
    getSystemSettings(),
  ]);
  if (!settings) return null;
  return {
    aiSummariesEnabled: settings.aiSummariesEnabled,
    aiModel: system.aiModel,
    aiApiKey: system.aiApiKey,
    aiPrompt: system.aiPrompt,
    topics: topicVocabulary(settings.customTopics ?? [], {
      base: system.defaultTopics ?? [],
      excluded: settings.excludedTopics ?? [],
    }),
  };
}

export function aiUsable(settings: AiSettings | null): settings is AiSettings {
  return Boolean(settings?.aiSummariesEnabled && settings?.aiApiKey);
}

export interface TaskResult {
  ok: boolean;
  reason?: string;
}

/** An article with no text cannot be summarized or classified. */
async function articleFor(articleId: string, userId: string) {
  const article = await prisma.article.findFirst({
    where: { id: articleId, userId },
    select: { title: true, url: true, siteName: true, content: true },
  });
  if (!article) return null;
  return article.content.trim() ? article : null;
}

/** Assigns topic tags from the article's text. Cheap; safe to run in bulk. */
export async function classifyArticle(
  articleId: string,
  userId: string,
  settings?: AiSettings | null,
): Promise<TaskResult> {
  const resolved = settings ?? (await loadAiSettings(userId));
  // Tagging needs a key. The summaries switch only gates summaries.
  if (!resolved?.aiApiKey) return { ok: false, reason: "AI is not configured" };

  const article = await articleFor(articleId, userId);
  if (!article) return { ok: false, reason: "no article text to classify" };

  if (resolved.topics.length === 0) {
    await prisma.article.update({
      where: { id: articleId },
      data: { classifiedAt: new Date() },
    });
    return { ok: true };
  }

  try {
    const topics = await classifyTopics(article, {
      model: resolved.aiModel,
      apiKey: resolved.aiApiKey,
      topics: resolved.topics,
    });
    // Replace the previous automatic topics so a second pass does not
    // accumulate labels the model no longer chose. Manual tags stay.
    await prisma.articleTag.deleteMany({
      where: { articleId, source: "AUTO", tag: { kind: "TOPIC" } },
    });
    if (topics.length > 0) {
      const ensured = await ensureTags(
        userId,
        topics.map((name) => ({ name, kind: "TOPIC" as const })),
      );
      await attachTags(
        articleId,
        ensured.map((t) => t.id),
        "AUTO",
      );
    }
    // Stamped even when the model had no opinion, so a re-run does not pay to
    // ask the same question again.
    await prisma.article.update({
      where: { id: articleId },
      data: { classifiedAt: new Date() },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "classification failed",
    };
  }
}

/** Writes the AI summary. The expensive one. */
export async function summarizeArticle(
  articleId: string,
  userId: string,
  settings?: AiSettings | null,
): Promise<TaskResult> {
  const resolved = settings ?? (await loadAiSettings(userId));
  if (!aiUsable(resolved)) return { ok: false, reason: "AI is not configured" };

  const article = await articleFor(articleId, userId);
  if (!article) return { ok: false, reason: "no article text to summarize" };

  try {
    const summary = await generateSummary(article, {
      model: resolved.aiModel,
      apiKey: resolved.aiApiKey!,
      prompt: resolved.aiPrompt,
    });
    await prisma.article.update({
      where: { id: articleId },
      data: { summary },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "summary failed",
    };
  }
}

/**
 * Both tasks for a freshly saved article, which is the behaviour saving has
 * always had. Failures are logged rather than surfaced: the reader offers a
 * manual retry for the summary, and tags can be added by hand.
 */
export async function runAiTasksOnSave(
  articleId: string,
  userId: string,
): Promise<void> {
  const settings = await loadAiSettings(userId);
  if (!aiUsable(settings)) return;

  const summary = await summarizeArticle(articleId, userId, settings);
  if (!summary.ok) {
    console.error(`AI summary failed for article ${articleId}: ${summary.reason}`);
  }
  // Independent of the summary: a failure above must not skip tagging.
  const classify = await classifyArticle(articleId, userId, settings);
  if (!classify.ok) {
    console.error(
      `Topic classification failed for article ${articleId}: ${classify.reason}`,
    );
  }
}
