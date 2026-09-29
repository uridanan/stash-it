import { NextResponse } from "next/server";
import type { JobType } from "@prisma/client";

import { requireUser } from "@/lib/api-auth";
import {
  activeJob,
  countRemaining,
  estimateCost,
  JobConflictError,
  reapAbandonedJobs,
  recentJobs,
  requestCancel,
  startJob,
} from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: JobType[] = ["FETCH_CONTENT", "CLASSIFY", "SUMMARIZE"];

function parseType(value: unknown): JobType | null {
  return TYPES.includes(value as JobType) ? (value as JobType) : null;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * The state of the three fill-in axes: what is outstanding on each, what a
 * run would cost, and whichever job is currently going.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  // A runner lives in the server process, so a restart abandons it. Clear the
  // stale row here rather than letting it block every future job.
  await reapAbandonedJobs(user.userId);

  const [remaining, summarize, active, recent] = await Promise.all([
    Promise.all(
      TYPES.map(async (type) => [type, await countRemaining(user.userId, type)] as const),
    ),
    estimateCost(user.userId, "SUMMARIZE"),
    activeJob(user.userId),
    recentJobs(user.userId),
  ]);

  return NextResponse.json({
    remaining: Object.fromEntries(remaining),
    summarizeEstimate: summarize,
    active,
    recent,
  });
}

/** Starts a job, or cancels the running one when `cancel` names it. */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { type, force, cancel } = (body ?? {}) as {
    type?: unknown;
    force?: unknown;
    cancel?: unknown;
  };

  if (typeof cancel === "string" && cancel) {
    const stopped = await requestCancel(cancel, user.userId);
    return stopped
      ? NextResponse.json({ ok: true })
      : jsonError("No such running job", 404);
  }

  const jobType = parseType(type);
  if (!jobType) {
    return jsonError(
      "Invalid type: expected FETCH_CONTENT, CLASSIFY or SUMMARIZE",
      422,
    );
  }

  try {
    const job = await startJob(user.userId, jobType, {
      force: force === true,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof JobConflictError) return jsonError(err.message, 409);
    console.error("Could not start job:", err);
    return jsonError("Could not start that job", 500);
  }
}
