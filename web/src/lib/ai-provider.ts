/**
 * Shared HTTP plumbing for the BYO-key AI providers, used by both article
 * summaries (`summarize.ts`) and topic classification (`classify.ts`).
 *
 * The error class is a parameter rather than a fixed type: each caller keeps
 * throwing its own error, so `instanceof` checks at the API routes keep working
 * exactly as they did before this was extracted.
 */

export const AI_REQUEST_TIMEOUT_MS = 60_000;

export interface ProviderErrorConstructor {
  new (message: string): Error;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function toProviderError(
  providerName: string,
  err: unknown,
  ErrorClass: ProviderErrorConstructor,
): Error {
  const message = err instanceof Error ? err.message : String(err);
  // Never include the API key in errors; provider messages don't echo it.
  return new ErrorClass(`${providerName}: ${truncate(message, 300)}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerName: string,
  ErrorClass: ProviderErrorConstructor,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw toProviderError(providerName, err, ErrorClass);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = await res.json();
      detail = parsed?.error?.message ?? "";
    } catch {
      // Non-JSON error body — status alone will have to do.
    }
    throw new ErrorClass(
      `${providerName}: HTTP ${res.status}${detail ? ` — ${truncate(detail, 200)}` : ""}`,
    );
  }
  return res.json();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
