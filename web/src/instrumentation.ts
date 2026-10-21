/**
 * Picks up fill-in jobs that were still running when this process last
 * stopped, so a deploy or a restart continues them without anyone opening
 * Settings.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { resumeRunningJobs } = await import("@/lib/jobs");
    await resumeRunningJobs();
  } catch (err) {
    console.error("Could not resume background jobs:", err);
  }
}
