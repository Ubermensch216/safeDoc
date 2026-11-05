import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9334;
const USER_DATA = 'd:\\Dev\\safeDoc\\.tmp_chrome';

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--disable-gpu',
    '--window-size=1366,850',
    'http://localhost:8080',
  ]);

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await wait(300);
    try {
      targets = await getJson(`http://localhost:${DEBUG_PORT}/json`);
      if (targets && targets.length > 0) break;
    } catch {}
  }

  if (!targets || targets.length === 0) {
    console.error('Failed to connect to Chrome debug port');
    chrome.kill();
    return;
  }

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  await new Promise((r) => (ws.onopen = r));

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  await wait(2000); // Wait for page to initialize and Ollama check

  // 1. Settings tab - Policy
  console.log('Capturing Settings Policy...');
  await send('Runtime.evaluate', {
    expression: "document.querySelector('#tabbtn-settings').click();",
  });
  await wait(800);
  let res = await send('Page.captureScreenshot', { format: 'png' });
  if (res && res.data) {
    fs.writeFileSync('d:\\Dev\\safeDoc\\doc\\images\\03_settings_policy.png', Buffer.from(res.data, 'base64'));
  }

  // 2. Settings tab - AI Engine
  console.log('Capturing Settings AI Engine...');
  await send('Runtime.evaluate', {
    expression: `
      const aiBtn = document.querySelector('button[data-settings="ai"]');
      if (aiBtn) aiBtn.click();
      const details = document.querySelector('.advanced-settings');
      if (details) details.open = true;
    `,
  });
  await wait(800);
  res = await send('Page.captureScreenshot', { format: 'png' });
  if (res && res.data) {
    fs.writeFileSync('d:\\Dev\\safeDoc\\doc\\images\\03_settings_ai.png', Buffer.from(res.data, 'base64'));
  }

  // 3. Restore tab
  console.log('Capturing Restore...');
  await send('Runtime.evaluate', {
    expression: "document.querySelector('#tabbtn-restore').click();",
  });
  await wait(800);
  res = await send('Page.captureScreenshot', { format: 'png' });
  if (res && res.data) {
    fs.writeFileSync('d:\\Dev\\safeDoc\\doc\\images\\04_restore.png', Buffer.from(res.data, 'base64'));
  }

  await wait(500);
  ws.close();
  chrome.kill();
  console.log('Done capturing screenshots.');
}

main().catch(console.error);
