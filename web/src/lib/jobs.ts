import type { JobType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { classifyArticle, loadAiSettings, summarizeArticle } from "@/lib/ai-tasks";
import { fillStub } from "@/lib/backup";

/**
 * The three fill-in jobs: fetch article text, classify topics, write summaries.
 *
 * Nothing about what remains to be done is stored. It is derived from the
 * articles themselves — empty content, null `classifiedAt`, null `summary` —
 * so a job resumes correctly after a restart, and a job started twice cannot
 * do the same work twice over. The `BackgroundJob` row holds only counters and
 * lifecycle so the UI has something to poll.
 */

/** Pause between items. Fetching hits other people's servers; be polite. */
const DELAY_MS: Record<JobType, number> = {
  FETCH_CONTENT: 400,
  CLASSIFY: 150,
  SUMMARIZE: 250,
};

/** Above this many articles, summarising asks for explicit confirmation. */
export const SUMMARIZE_CONFIRM_THRESHOLD = 200;

/**
 * Characters of article text sent per call, mirroring the constants in
 * `classify.ts` and `summarize.ts`. Kept here so the estimate cannot silently
 * drift from what the callers actually send.
 */
const INPUT_CHARS: Record<JobType, number> = {
  FETCH_CONTENT: 0,
  CLASSIFY: 12_000,
  SUMMARIZE: 60_000,
};
const OUTPUT_TOKENS: Record<JobType, number> = {
  FETCH_CONTENT: 0,
  CLASSIFY: 128,
  SUMMARIZE: 1_024,
};
/** Rough characters per token for English prose. */
const CHARS_PER_TOKEN = 4;

export interface CostEstimate {
  articles: number;
  /** Upper bound — most articles are shorter than the truncation limit. */
  inputTokens: number;
  outputTokens: number;
  model: string | null;
  needsConfirmation: boolean;
}

/**
 * An upper bound on the tokens a job would spend.
 *
 * Deliberately expressed in tokens and not currency: provider prices change
 * and hardcoding them would quietly go stale. The model name is included so
 * the figure can be checked against that provider's pricing page.
 */
export async function estimateCost(
  userId: string,
  type: JobType,
): Promise<CostEstimate> {
  const articles = await countRemaining(userId, type);
  const settings = await loadAiSettings(userId);
  const perInput = Math.ceil(INPUT_CHARS[type] / CHARS_PER_TOKEN);
  return {
    articles,
    inputTokens: articles * perInput,
    outputTokens: articles * OUTPUT_TOKENS[type],
    model: settings?.aiModel ?? null,
    needsConfirmation:
      type === "SUMMARIZE" && articles > SUMMARIZE_CONFIRM_THRESHOLD,
  };
}

/**
 * What each job considers outstanding.
 *
 * A forced fetch is the exception: every article qualifies, and it stays
 * qualified after being handled, so those jobs walk the library by cursor
 * instead of re-querying for gaps.
 */
function remainingWhere(userId: string, type: JobType, force = false) {
  switch (type) {
    case "FETCH_CONTENT":
      if (force) return { userId };
      // Stubs only: an article whose extraction already failed is not retried
      // in bulk, or every run would hammer the same dead links.
      return { userId, content: "", extractionFailed: false };
    case "CLASSIFY":
      return { userId, classifiedAt: null, NOT: { content: "" } };
    case "SUMMARIZE":
      return { userId, summary: null, NOT: { content: "" } };
  }
}

export function countRemaining(
  userId: string,
  type: JobType,
  force = false,
): Promise<number> {
  return prisma.article.count({ where: remainingWhere(userId, type, force) });
}

export interface JobProgress {
  id: string;
  type: JobType;
  status: string;
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export async function activeJob(userId: string): Promise<JobProgress | null> {
  const job = await prisma.backgroundJob.findFirst({
    where: { userId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  return job ? toProgress(job) : null;
}

export async function recentJobs(userId: string): Promise<JobProgress[]> {
  const jobs = await prisma.backgroundJob.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  return jobs.map(toProgress);
}

function toProgress(job: {
  id: string;
  type: JobType;
  status: string;
  total: number;
  done: number;
  failed: number;
  cancelRequested: boolean;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): JobProgress {
  return {
    ...job,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function requestCancel(jobId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: { id: jobId, userId, status: "RUNNING" },
    data: { cancelRequested: true },
  });
  return count > 0;
}

export class JobConflictError extends Error {}

/**
 * Starts a job and returns immediately; the work continues in the background.
 *
 * One job at a time per user. Two running at once would interleave writes to
 * the same articles and make the counters meaningless, and the fetching job in
 * particular should not compete with itself for other people's servers.
 */
export async function startJob(
  userId: string,
  type: JobType,
  options: { force?: boolean } = {},
): Promise<JobProgress> {
  const running = await prisma.backgroundJob.findFirst({
    where: { userId, status: "RUNNING" },
    select: { id: true, type: true },
  });
  if (running) {
    throw new JobConflictError(
      `A ${running.type.toLowerCase().replace("_", " ")} job is already running`,
    );
  }

  const force = Boolean(options.force);
  const total = await countRemaining(userId, type, force);
  const job = await prisma.backgroundJob.create({
    data: { userId, type, total, force },
  });

  void run(job.id, userId, type, force);
  return toProgress(job);
}

/** How many articles to claim per pass. Keeps the working set small. */
const PAGE = 25;

async function run(
  jobId: string,
  userId: string,
  type: JobType,
  force = false,
): Promise<void> {
  const settings = type === "FETCH_CONTENT" ? null : await loadAiSettings(userId);
  let done = 0;
  let failed = 0;
  let cursor: string | null = null;

  try {
    for (;;) {
      const job = await prisma.backgroundJob.findUnique({
        where: { id: jobId },
        select: { cancelRequested: true },
      });
      if (!job || job.cancelRequested) {
        await finish(jobId, "CANCELLED", done, failed);
        return;
      }

      // Gap-filling jobs re-query: each item stops being outstanding once it
      // is handled, so the first page is always the next work to do. A forced
      // job cannot do that — the article still qualifies afterwards — so it
      // advances a cursor instead.
      // Annotated because cursor is derived from batch, which would
      // otherwise make the inference circular.
      const batch: { id: string }[] = force
        ? await prisma.article.findMany({
            where: {
              ...remainingWhere(userId, type, true),
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: PAGE,
          })
        : await prisma.article.findMany({
            where: remainingWhere(userId, type),
            select: { id: true },
            orderBy: { savedAt: "desc" },
            take: PAGE,
          });
      if (batch.length === 0) break;

      for (const article of batch) {
        const result =
          type === "FETCH_CONTENT"
            ? await fillStub(article.id, userId, { force })
            : type === "CLASSIFY"
              ? await classifyArticle(article.id, userId, settings)
              : await summarizeArticle(article.id, userId, settings);

        if (result.ok) done += 1;
        else failed += 1;
        cursor = article.id;

        await prisma.backgroundJob.update({
          where: { id: jobId },
          data: { done, failed, ...(force ? { cursor } : {}) },
        });

        // A task that cannot make progress at all — no API key, say — would
        // otherwise spin through the whole library failing every item.
        if (!result.ok && result.reason?.includes("not configured")) {
          await finish(jobId, "FAILED", done, failed, result.reason);
          return;
        }

        const cancelled = await prisma.backgroundJob.findUnique({
          where: { id: jobId },
          select: { cancelRequested: true },
        });
        if (cancelled?.cancelRequested) {
          await finish(jobId, "CANCELLED", done, failed);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS[type]));
      }
    }
    await finish(jobId, "DONE", done, failed);
  } catch (err) {
    console.error(`Job ${jobId} (${type}) failed:`, err);
    await finish(
      jobId,
      "FAILED",
      done,
      failed,
      err instanceof Error ? err.message : "job failed",
    );
  }
}

async function finish(
  jobId: string,
  status: "DONE" | "CANCELLED" | "FAILED",
  done: number,
  failed: number,
  error?: string,
): Promise<void> {
  await prisma.backgroundJob
    .update({
      where: { id: jobId },
      data: { status, done, failed, finishedAt: new Date(), error: error ?? null },
    })
    .catch(() => {
      // The job row was deleted underneath us; nothing left to record.
    });
}

/**
 * Marks any job left RUNNING by a previous process as failed.
 *
 * Runners live in the server process, so a restart abandons them. Without this
 * a stale row would block every future job as "already running".
 */
export async function reapAbandonedJobs(userId: string): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: {
      userId,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 6) },
    },
    data: {
      status: "FAILED",
      error: "interrupted by a server restart",
      finishedAt: new Date(),
    },
  });
}
