import { getSettings, saveUrl } from './common.js';

const saveBtn = document.getElementById('save-btn');
const saveLabel = document.getElementById('save-label');
const spinner = document.getElementById('spinner');
const statusEl = document.getElementById('status');
const faviconEl = document.getElementById('favicon');
const titleEl = document.getElementById('tab-title');
const urlEl = document.getElementById('tab-url');

let currentTab = null;

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function setStatus(kind, html) {
  statusEl.className = kind ?? '';
  statusEl.innerHTML = html ?? '';
}

function setSaving(saving) {
  saveBtn.disabled = saving;
  spinner.classList.toggle('hidden', !saving);
  saveLabel.textContent = saving ? 'Saving…' : 'Save for later';
}

function showNoTokenStatus() {
  setStatus(
    'error',
    'No API token configured. <a id="status-options-link">Open options</a> to set one up.'
  );
  document
    .getElementById('status-options-link')
    .addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;

  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    titleEl.textContent = tab?.title || 'This page';
    urlEl.textContent = tab?.url || '';
    saveBtn.disabled = true;
    setStatus('info', 'This page cannot be saved (only http/https pages).');
    return;
  }

  titleEl.textContent = tab.title || tab.url;
  urlEl.textContent = tab.url;
  if (tab.favIconUrl) {
    faviconEl.src = tab.favIconUrl;
    faviconEl.classList.remove('hidden');
  }

  const { apiToken } = await getSettings();
  if (!apiToken) showNoTokenStatus();
}

saveBtn.addEventListener('click', async () => {
  if (!currentTab?.url) return;

  setSaving(true);
  setStatus('', '');

  const result = await saveUrl(currentTab.url);
  setSaving(false);

  if (result.ok) {
    const title = result.article?.title;
    if (result.duplicate) {
      setStatus('info', 'Already saved — moved to top.');
    } else {
      const suffix = title ? ` — ${escapeHtml(title)}` : '';
      setStatus('success', `Saved ✓${suffix}`);
    }
    return;
  }

  if (result.reason === 'no-token') {
    showNoTokenStatus();
    return;
  }
  setStatus('error', escapeHtml(result.message));
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

init();
