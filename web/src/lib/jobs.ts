import type { JobType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { classifyArticle, loadAiSettings, summarizeArticle } from "@/lib/ai-tasks";
import { fillStub } from "@/lib/backup";
import { TEXT_ARTICLE_PREFIX } from "@/lib/source-url";

/**
 * The three fill-in jobs: fetch article text, classify topics, write summaries.
 *
 * What remains to be done is derived from the articles themselves — empty
 * content, null `classifiedAt`, null `summary` — so a restarted runner
 * continues the same job instead of repeating finished work. Counters,
 * the cursor, and every failure are stored on the job row, which is what
 * the settings page reads when it is opened again.
 *
 * The runner is not tied to the request that started it. Leaving the page
 * ends that request; the work keeps going in this process, and a process
 * that died picks the job back up the next time it starts or the page asks.
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
      // Text articles have no page to fetch. A forced pass would otherwise
      // walk them and report a failure for every one.
      if (force) {
        return { userId, NOT: { url: { startsWith: TEXT_ARTICLE_PREFIX } } };
      }
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

/** Done and left for one fill-in pass, counted across the whole library. */
export interface FillInCount {
  done: number;
  left: number;
  /**
   * Fetch: the page was tried and could not be read, so it is not left to do.
   * Classify and summarize: the article has no text yet, so this pass cannot
   * start on it.
   */
  aside: number;
}

/**
 * How far each pass has got, derived from the articles rather than from the
 * last job's counters. A finished job forgets itself; the articles do not.
 */
export async function fillInProgress(
  userId: string,
): Promise<Record<JobType, FillInCount>> {
  const [row] = await prisma.$queryRaw<
    {
      fetch_done: number;
      fetch_left: number;
      fetch_failed: number;
      classify_done: number;
      classify_left: number;
      summarize_done: number;
      summarize_left: number;
      no_text: number;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE content <> '')::int AS fetch_done,
      COUNT(*) FILTER (WHERE content = '' AND "extractionFailed" = false)::int AS fetch_left,
      COUNT(*) FILTER (WHERE content = '' AND "extractionFailed" = true)::int AS fetch_failed,
      COUNT(*) FILTER (WHERE content <> '' AND "classifiedAt" IS NOT NULL)::int AS classify_done,
      COUNT(*) FILTER (WHERE content <> '' AND "classifiedAt" IS NULL)::int AS classify_left,
      COUNT(*) FILTER (WHERE content <> '' AND summary IS NOT NULL)::int AS summarize_done,
      COUNT(*) FILTER (WHERE content <> '' AND summary IS NULL)::int AS summarize_left,
      COUNT(*) FILTER (WHERE content = '')::int AS no_text
    FROM "Article"
    WHERE "userId" = ${userId}
  `;

  const counts = row ?? {
    fetch_done: 0,
    fetch_left: 0,
    fetch_failed: 0,
    classify_done: 0,
    classify_left: 0,
    summarize_done: 0,
    summarize_left: 0,
    no_text: 0,
  };

  return {
    FETCH_CONTENT: {
      done: counts.fetch_done,
      left: counts.fetch_left,
      aside: counts.fetch_failed,
    },
    CLASSIFY: {
      done: counts.classify_done,
      left: counts.classify_left,
      aside: counts.no_text,
    },
    SUMMARIZE: {
      done: counts.summarize_done,
      left: counts.summarize_left,
      aside: counts.no_text,
    },
  };
}

/** One article this run could not finish, kept for the report. */
export interface JobFailure {
  articleId: string;
  title: string;
  url: string;
  reason: string;
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
  /** Present for a finished job. Empty while one is still running. */
  failures: JobFailure[];
}

export async function activeJob(userId: string): Promise<JobProgress | null> {
  const job = await prisma.backgroundJob.findFirst({
    where: { userId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  // The live poll only needs the counters. The failure list arrives with
  // the finished job, once, instead of on every tick.
  return job ? toProgress(job, false) : null;
}

export async function recentJobs(userId: string): Promise<JobProgress[]> {
  const jobs = await prisma.backgroundJob.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  let includedFailures = false;
  return jobs.map((job) => {
    const include = job.status !== "RUNNING" && !includedFailures;
    if (include) includedFailures = true;
    return toProgress(job, include);
  });
}

function toProgress(
  job: {
    id: string;
    type: JobType;
    status: string;
    total: number;
    done: number;
    failed: number;
    cancelRequested: boolean;
    error: string | null;
    failures: Prisma.JsonValue;
    startedAt: Date;
    finishedAt: Date | null;
  },
  includeFailures: boolean,
): JobProgress {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    cancelRequested: job.cancelRequested,
    error: job.error,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    failures: includeFailures ? parseFailures(job.failures) : [],
  };
}

function parseFailures(value: Prisma.JsonValue): JobFailure[] {
  if (!Array.isArray(value)) return [];
  const failures: JobFailure[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.articleId !== "string" || typeof row.reason !== "string") continue;
    failures.push({
      articleId: row.articleId,
      title: typeof row.title === "string" ? row.title : "",
      url: typeof row.url === "string" ? row.url : "",
      reason: row.reason,
    });
  }
  return failures;
}

function clip(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
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
 * Starts a job and returns immediately; the work continues in this process
 * after the response is sent.
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

  const pending = kickJob(job.id);
  await trackForPlatform(pending);
  return toProgress(job, false);
}

/**
 * Continues any job this process is not already running.
 *
 * Called when the settings page asks, and once when the server starts. A
 * runner that died — a deploy, a restart, an instance that was shut down —
 * leaves the row RUNNING, and the next process carries on from the counters
 * already stored.
 */
export async function resumeRunningJobs(userId?: string): Promise<void> {
  const jobs = await prisma.backgroundJob.findMany({
    where: { status: "RUNNING", ...(userId ? { userId } : {}) },
    select: { id: true },
  });
  for (const job of jobs) kickJob(job.id);
}

/**
 * Promises for jobs this process is running, kept on globalThis so a dev
 * reload of this module does not start a second runner beside the first.
 */
const globalForJobs = globalThis as unknown as {
  jobRuns?: Map<string, Promise<void>>;
};
const localRuns = globalForJobs.jobRuns ?? new Map<string, Promise<void>>();
globalForJobs.jobRuns = localRuns;

/** How long a silent runner may hold a job before another process may take it. */

/** How many articles to claim per pass. Keeps the working set small. */
const PAGE = 25;

/**
 * While a job is running, two things have to keep happening after the
 * browser is gone. Resume any RUNNING row this process dropped, and — in
 * production — ping the public URL so a host that shuts idle instances down
 * (Cloud Run, after 15 minutes without a request) still sees traffic. The
 * ping has to land on this instance, which is why the service runs as one.
 */
const KEEPALIVE_MS = 20_000;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepalive(): void {
  if (keepaliveTimer) return;
  const timer = setInterval(() => {
    void tickKeepalive(timer);
  }, KEEPALIVE_MS);
  keepaliveTimer = timer;
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}

async function tickKeepalive(timer: ReturnType<typeof setInterval>): Promise<void> {
  try {
    await resumeRunningJobs();
  } catch {
    // The next tick tries again.
  }
  if (localRuns.size === 0) {
    clearInterval(timer);
    if (keepaliveTimer === timer) keepaliveTimer = null;
    return;
  }
  if (process.env.NODE_ENV !== "production") return;
  const base = process.env.AUTH_URL?.replace(/\/$/, "");
  if (!base) return;
  await fetch(`${base}/api/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    // A missed ping does not stop the job.
  });
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const message = "message" in err ? String(err.message) : "";
  return name === "AbortError" || name === "ResponseAborted" || /aborted/i.test(message);
}

function kickJob(jobId: string): Promise<void> {
  const existing = localRuns.get(jobId);
  if (existing) return existing;

  const lockId = crypto.randomUUID();
  const promise = run(jobId, lockId).finally(() => {
    if (localRuns.get(jobId) === promise) localRuns.delete(jobId);
  });
  localRuns.set(jobId, promise);
  void promise.catch((err) => {
    console.error(`Job ${jobId} stopped unexpectedly:`, err);
  });
  ensureKeepalive();
  return promise;
}

/**
 * Registers the runner with the platform so a host that freezes the process
 * when the response ends keeps it alive instead. Outside a request (server
 * startup) there is nothing to register with, and the runner is already going.
 */
async function trackForPlatform(pending: Promise<void>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(pending);
  } catch {
    // `after` throws when it is called outside a request.
  }
}

/**
 * Takes the job if nobody holds it, or if the holder has stopped heartbeating.
 * One UPDATE, so two processes cannot both win it.
 */
async function claim(jobId: string, lockId: string): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE "BackgroundJob"
    SET "lockId" = ${lockId}, "heartbeatAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${jobId}
      AND "status" = 'RUNNING'::"JobStatus"
      AND (
        "lockId" IS NULL
        OR "lockId" = ${lockId}
        OR "heartbeatAt" < CURRENT_TIMESTAMP - INTERVAL '3 minutes'
      )
  `;
  return count > 0;
}

async function saveProgress(
  jobId: string,
  lockId: string,
  data: {
    done: number;
    failed: number;
    failures: JobFailure[];
    cursor: string | null;
  },
): Promise<boolean> {
  const { count } = await prisma.backgroundJob.updateMany({
    where: { id: jobId, lockId, status: "RUNNING" },
    data: {
      done: data.done,
      failed: data.failed,
      failures: data.failures as unknown as Prisma.InputJsonValue,
      cursor: data.cursor,
      heartbeatAt: new Date(),
    },
  });
  return count > 0;
}

async function run(jobId: string, lockId: string): Promise<void> {
  let done = 0;
  let failed = 0;
  let failures: JobFailure[] = [];
  let cursor: string | null = null;
  let type: JobType = "FETCH_CONTENT";
  let holding = false;

  try {
    holding = await claim(jobId, lockId);
    if (!holding) return;

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING" || job.lockId !== lockId) return;

    type = job.type;
    const force = job.force;
    const userId = job.userId;
    done = job.done;
    failed = job.failed;
    failures = parseFailures(job.failures);
    cursor = job.cursor;

    const settings = type === "FETCH_CONTENT" ? null : await loadAiSettings(userId);

    for (;;) {
      const fresh = await prisma.backgroundJob.findUnique({
        where: { id: jobId },
        select: { cancelRequested: true, lockId: true },
      });
      if (!fresh || fresh.lockId !== lockId) return;
      if (fresh.cancelRequested) {
        await finish(jobId, lockId, "CANCELLED", done, failed, failures);
        return;
      }

      const failedIds = failures.map((failure) => failure.articleId);
      // Gap-filling jobs re-query: each success stops being outstanding, and
      // each failure is skipped for the rest of this run so a dead link or a
      // rejected summary cannot be asked forever. A forced job cannot do
      // that — the article still qualifies afterwards — so it walks by cursor.
      const batch = force
        ? await prisma.article.findMany({
            where: {
              ...remainingWhere(userId, type, true),
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            select: { id: true, title: true, url: true },
            orderBy: { id: "asc" },
            take: PAGE,
          })
        : await prisma.article.findMany({
            where: {
              ...remainingWhere(userId, type),
              ...(failedIds.length > 0 ? { id: { notIn: failedIds } } : {}),
            },
            select: { id: true, title: true, url: true },
            orderBy: { savedAt: "desc" },
            take: PAGE,
          });
      if (batch.length === 0) break;

      for (const article of batch) {
        // Heartbeat before the slow call, so a long fetch does not look like
        // a dead runner to another process.
        const held = await saveProgress(jobId, lockId, { done, failed, failures, cursor });
        if (!held) return;

        const result =
          type === "FETCH_CONTENT"
            ? await fillStub(article.id, userId, { force })
            : type === "CLASSIFY"
              ? await classifyArticle(article.id, userId, settings)
              : await summarizeArticle(article.id, userId, settings);

        if (result.ok) {
          done += 1;
        } else {
          failed += 1;
          failures.push({
            articleId: article.id,
            title: article.title,
            url: article.url,
            reason: clip(result.reason ?? "failed"),
          });
        }
        cursor = article.id;

        const wrote = await saveProgress(jobId, lockId, {
          done,
          failed,
          failures,
          cursor,
        });
        if (!wrote) return;

        // A task that cannot make progress at all — no API key, say — would
        // otherwise spin through the whole library failing every item.
        if (!result.ok && result.reason?.includes("not configured")) {
          await finish(jobId, lockId, "FAILED", done, failed, failures, result.reason);
          return;
        }

        const cancelled = await prisma.backgroundJob.findUnique({
          where: { id: jobId },
          select: { cancelRequested: true, lockId: true },
        });
        if (!cancelled || cancelled.lockId !== lockId) return;
        if (cancelled.cancelRequested) {
          await finish(jobId, lockId, "CANCELLED", done, failed, failures);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, DELAY_MS[type]));
      }
    }
    await finish(jobId, lockId, "DONE", done, failed, failures);
  } catch (err) {
    // A disconnect aborts whatever fetch was in flight. The articles already
    // counted stay counted; the row stays RUNNING so the watchdog can continue
    // it. Marking the job failed here is what made leaving the page look final.
    if (isAbort(err)) {
      console.error(`Job ${jobId} (${type}) was aborted; it will resume`);
      return;
    }
    console.error(`Job ${jobId} (${type}) failed:`, err);
    await finish(
      jobId,
      lockId,
      "FAILED",
      done,
      failed,
      failures,
      err instanceof Error ? err.message : "job failed",
    );
  } finally {
    if (holding) {
      await prisma.backgroundJob
        .updateMany({
          where: { id: jobId, lockId, status: "RUNNING" },
          data: { lockId: null },
        })
        .catch(() => {
          // The row is already gone.
        });
    }
  }
}

async function finish(
  jobId: string,
  lockId: string,
  status: "DONE" | "CANCELLED" | "FAILED",
  done: number,
  failed: number,
  failures: JobFailure[],
  error?: string,
): Promise<void> {
  await prisma.backgroundJob
    .updateMany({
      where: { id: jobId, lockId },
      data: {
        status,
        done,
        failed,
        failures: failures as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        error: error ?? null,
        lockId: null,
        heartbeatAt: new Date(),
      },
    })
    .catch(() => {
      // The job row was deleted underneath us; nothing left to record.
    });
}
