// Shared settings + API helpers for popup, options and background.
// Plain ES module — no build step.

export const DEFAULT_SERVER_URL = 'http://localhost:3000';

/** Read settings from chrome.storage.sync, with defaults applied. */
export async function getSettings() {
  const { serverUrl, apiToken } = await chrome.storage.sync.get({
    serverUrl: DEFAULT_SERVER_URL,
    apiToken: '',
  });
  return {
    serverUrl: normalizeServerUrl(serverUrl),
    apiToken: (apiToken ?? '').trim(),
  };
}

/** Persist settings to chrome.storage.sync. */
export async function setSettings({ serverUrl, apiToken }) {
  await chrome.storage.sync.set({
    serverUrl: normalizeServerUrl(serverUrl),
    apiToken: (apiToken ?? '').trim(),
  });
}

/** Trim whitespace and trailing slashes; fall back to the default. */
export function normalizeServerUrl(url) {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_SERVER_URL;
}

/**
 * Save a URL to Stash.
 * Resolves to one of:
 *   { ok: true, duplicate: boolean, article }
 *   { ok: false, reason: 'no-token' | 'unauthorized' | 'network' | 'server', message }
 */
export async function saveUrl(url) {
  const { serverUrl, apiToken } = await getSettings();
  if (!apiToken) {
    return {
      ok: false,
      reason: 'no-token',
      message: 'No API token configured.',
    };
  }

  let res;
  try {
    res = await fetch(`${serverUrl}/api/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    return {
      ok: false,
      reason: 'network',
      message: `Could not reach ${serverUrl}. Is the server running?`,
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      reason: 'unauthorized',
      message: 'Invalid API token. Check the extension options.',
    };
  }

  const body = await res.json().catch(() => null);

  if (res.status === 201 || res.status === 200) {
    return {
      ok: true,
      duplicate: res.status === 200,
      article: body?.article ?? null,
    };
  }

  return {
    ok: false,
    reason: 'server',
    message: body?.error || `Server error (HTTP ${res.status}).`,
  };
}

/**
 * Test connectivity + credentials against GET /api/articles?limit=1.
 * Resolves to { ok: boolean, message }.
 */
export async function testConnection(serverUrl, apiToken) {
  const base = normalizeServerUrl(serverUrl);
  const token = (apiToken ?? '').trim();
  if (!token) {
    return { ok: false, message: 'Enter an API token first.' };
  }

  let res;
  try {
    res = await fetch(`${base}/api/articles?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, message: `Could not reach ${base}. Is the server running?` };
  }

  if (res.status === 401) {
    return { ok: false, message: 'Server reachable, but the token was rejected (401).' };
  }
  if (!res.ok) {
    return { ok: false, message: `Unexpected response (HTTP ${res.status}).` };
  }

  const body = await res.json().catch(() => null);
  if (!body || !Array.isArray(body.articles)) {
    return { ok: false, message: 'Server responded, but not with the Stash API shape.' };
  }
  return { ok: true, message: 'Connected — token accepted.' };
}
