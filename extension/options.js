import { getSettings, setSettings, testConnection, DEFAULT_SERVER_URL } from './common.js';

const serverInput = document.getElementById('server-url');
const tokenInput = document.getElementById('api-token');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const messageEl = document.getElementById('message');

function setMessage(kind, text) {
  messageEl.className = kind ?? '';
  messageEl.textContent = text ?? '';
}

async function init() {
  const { serverUrl, apiToken } = await getSettings();
  serverInput.value = serverUrl || DEFAULT_SERVER_URL;
  tokenInput.value = apiToken;
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  try {
    await setSettings({
      serverUrl: serverInput.value,
      apiToken: tokenInput.value,
    });
    // Re-read so the inputs reflect the normalized values.
    const { serverUrl, apiToken } = await getSettings();
    serverInput.value = serverUrl;
    tokenInput.value = apiToken;
    setMessage('success', 'Settings saved.');
  } catch (err) {
    setMessage('error', `Could not save settings: ${err?.message ?? err}`);
  } finally {
    saveBtn.disabled = false;
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  setMessage('info', 'Testing connection…');
  try {
    const result = await testConnection(serverInput.value, tokenInput.value);
    setMessage(result.ok ? 'success' : 'error', result.message);
  } finally {
    testBtn.disabled = false;
  }
});

init();
