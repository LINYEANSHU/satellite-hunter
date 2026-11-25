const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const standalone = existsSync(path.join(root, 'app.json'));
const configs = standalone ? [require('../app.json')] : require('../apps.json');
const qa = path.join(root, 'qa');

async function waitUntil(find, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let result;
  do {
    result = await find();
    if (result) return result;
    await delay(125);
  } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}

async function debuggingPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function attach(address) {
  const socket = new WebSocket(address);
  const pending = new Map();
  const exceptions = [];
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      exceptions.push(detail.exception?.description || detail.text);
    }
    const response = pending.get(message.id);
    if (!response) return;
    pending.delete(message.id);
    if (message.error) response.reject(new Error(message.error.message));
    else response.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('DevTools connection closed'));
    pending.clear();
  });
  async function send(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }
  return { send, evaluate, socket, exceptions };
}

async function screenshot(client, file) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buffer = Buffer.from(result.data, 'base64');
  assert.ok(buffer.length > 5000, 'Screenshot contains a rendered window');
  await fs.writeFile(file, buffer);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

async function checkExe(config) {
  const executable = path.join(root, 'dist', config.exe, config.exe + '.exe');
  const profile = await fs.mkdtemp(path.join(qa, 'profile-'));
  const port = await debuggingPort();
  const endpoint = 'http://127.0.0.1:' + port;
  const child = spawn(executable, [
    '--user-data-dir=' + profile,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + port,
    '--enable-logging=stderr',
  ], { cwd: path.dirname(executable), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  child.stderr.on('data', chunk => { log = (log + chunk).slice(-24000); });
  const closed = new Promise(resolve => {
    child.once('error', error => resolve(error));
    child.once('exit', code => resolve(code));
  });
  let client;
  let browser;
  try {
    const version = await waitUntil(async () => {
      if (child.exitCode !== null) throw new Error('EXE exited with status ' + child.exitCode);
      return fetch(endpoint + '/json/version').then(response => response.json()).catch(() => false);
    }, 'the EXE exposes its local test endpoint');
    browser = await attach(version.webSocketDebuggerUrl);
    const downloadPath = path.join(profile, 'downloads');
    await fs.mkdir(downloadPath);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
    const page = await waitUntil(async () => {
      const targets = await fetch(endpoint + '/json/list').then(r => r.json());
      return targets.find(target => target.type === 'page' && target.url.startsWith('app://desktop'));
    }, 'the packaged desktop page loads');
    client = await attach(page.webSocketDebuggerUrl);
    await client.send('Runtime.enable');
    const { evaluate } = client;
    const wait = expression => waitUntil(() => evaluate('Boolean(' + expression + ')'), expression);
    await wait("document.querySelector('link[href=\"/desktop.css\"]')?.sheet");
    const adapter = standalone ? path.join(root, 'adapter') : path.join(root, 'apps', config.id);
    const scenario = require(path.join(adapter, 'smoke.cjs'));
    const details = await scenario({ send: client.send, evaluate, wait, waitUntil, downloadPath });
    const gpu = await browser.send('SystemInfo.getInfo');
    const renderer = gpu.gpu.auxAttributes.glRenderer || '';
    if (config.webgl) assert.match(renderer, /SwiftShader/i, 'The selected renderer must be CPU-only');
    else assert.notEqual(gpu.gpu.featureStatus.gpu_compositing, 'enabled');
    const full = await screenshot(client, path.join(qa, config.id + '.png'));
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 960, height: 640, deviceScaleFactor: 1, mobile: false,
    });
    await delay(350);
    const narrow = await screenshot(client, path.join(qa, config.id + '-960.png'));
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'Desktop surface stays inside a 960px viewport');
    assert.deepEqual(client.exceptions, [], 'No renderer exceptions');
    await browser.send('Browser.close').catch(() => {});
    const exit = await Promise.race([closed, delay(5000, 'timeout')]);
    assert.equal(exit, 0, 'The EXE closes cleanly');
    return { id: config.id, renderer, full, narrow, ...details };
  } finally {
    client?.socket.close();
    browser?.socket.close();
    if (child.exitCode === null) child.kill();
    await Promise.race([closed, delay(1000)]);
    await fs.writeFile(path.join(qa, config.id + '.log'), log);
  }
}

async function main() {
  await fs.mkdir(qa, { recursive: true });
  const ids = process.argv.slice(2);
  const selected = ids.length ? configs.filter(config => ids.includes(config.id)) : configs;
  assert.ok(selected.length > 0, 'Select at least one existing desktop app');
  const results = [];
  for (const config of selected) {
    try {
      const result = await checkExe(config);
      results.push(result);
      console.log('PASS', config.id, result.renderer, result.full.join('×'), result.narrow.join('×'));
    } catch (error) {
      results.push({ id: config.id, error: error.message });
      console.error('FAIL', config.id, error.message);
      process.exitCode = 1;
    }
  }
  await fs.writeFile(path.join(qa, 'exe-smoke.json'), JSON.stringify(results, null, 2) + '\n');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
