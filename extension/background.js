// MV3 service worker (ES module — see "type": "module" in manifest.json).
import { saveUrl } from './common.js';

const MENU_ID = 'stash-save';
const BADGE_MS = 3000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Save to Stash',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  // Prefer the right-clicked link; fall back to the page URL.
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url || !/^https?:/i.test(url)) {
    await flashBadge(tab?.id, false);
    return;
  }

  const result = await saveUrl(url);
  await flashBadge(tab?.id, result.ok);
});

/** Show "✓" (green) or "!" (red) on the action badge for a few seconds. */
async function flashBadge(tabId, ok) {
  const target = typeof tabId === 'number' ? { tabId } : {};
  try {
    await chrome.action.setBadgeBackgroundColor({
      ...target,
      color: ok ? '#16a34a' : '#dc2626',
    });
    await chrome.action.setBadgeText({ ...target, text: ok ? '✓' : '!' });
    setTimeout(() => {
      chrome.action.setBadgeText({ ...target, text: '' }).catch(() => {});
    }, BADGE_MS);
  } catch {
    // Tab may have been closed; nothing to do.
  }
}
