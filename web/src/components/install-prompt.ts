/**
 * Chrome and Edge fire `beforeinstallprompt` once, early. Hold onto it so the
 * install page can offer a button instead of hoping the browser's own banner
 * is still around when someone goes looking for it.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installPromptAvailable(): boolean {
  return deferred !== null;
}

/** Shows the browser's install dialog. The prompt can only be used once. */
export async function runInstallPrompt(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const pending = deferred;
  if (!pending) return "unavailable";
  deferred = null;
  notify();
  await pending.prompt();
  const choice = await pending.userChoice;
  return choice.outcome;
}

export function captureInstallPrompt(event: Event) {
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  notify();
}

export function clearInstallPrompt() {
  if (!deferred) return;
  deferred = null;
  notify();
}
