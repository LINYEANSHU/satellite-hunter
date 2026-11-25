const { spawn } = require('node:child_process');
const { access, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 3_500;

function backendError(code, message, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

async function startSatellite({ appRoot, userData }) {
  const backendDir = path.join(appRoot, 'backend');
  const dataDir = path.join(userData, 'data');
  const python = path.join(backendDir, 'python', 'python.exe');
  const script = path.join(backendDir, 'desktop-server.py');

  try {
    await Promise.all([access(python), access(script)]);
  } catch (error) {
    throw backendError('SATELLITE_RUNTIME_MISSING', '卫星服务文件缺失，请重新解压完整的游戏目录。', error);
  }
  try {
    await mkdir(dataDir, { recursive: true });
  } catch (error) {
    throw backendError('SATELLITE_DATA_DIRECTORY', `无法写入卫星存档目录 ${dataDir}`, error);
  }

  const child = spawn(python, ['-u', '-B', script], {
    cwd: backendDir,
    env: { ...process.env, SH_DATA_DIR: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdin.on('error', () => {});

  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let transcript = '';
  const log = (line) => { transcript = (transcript + line).slice(-4_000); };
  output.on('line', (line) => log(`${line}\n`));
  child.stderr.setEncoding('utf8').on('data', log);

  let launchError;
  child.on('error', (error) => { launchError = error; });
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, error: launchError }));
  });

  let stopping;
  function stop() {
    stopping ??= (async () => {
      child.stdin.end();
      const controller = new AbortController();
      const timeout = delay(SHUTDOWN_TIMEOUT_MS, { ref: false }, { signal: controller.signal }).catch(() => undefined);
      try {
        if (await Promise.race([exited, timeout]) === undefined) {
          child.kill();
          await exited;
        }
      } finally {
        controller.abort();
      }
    })();
    return stopping;
  }

  const announced = new Promise((resolve) => {
    const onLine = (line) => {
      const match = /^SATELLITE_BACKEND_PORT=(\d{1,5})$/.exec(line);
      if (!match) return;
      output.off('line', onLine);
      resolve(`http://127.0.0.1:${match[1]}`);
    };
    output.on('line', onLine);
  });

  const startup = new AbortController();
  const timer = setTimeout(() => startup.abort(), STARTUP_TIMEOUT_MS);
  const timedOut = new Promise((_, reject) => {
    startup.signal.addEventListener('abort', () => reject(backendError(
      'SATELLITE_STARTUP_TIMEOUT', '卫星服务启动超时。关闭后重新打开游戏可重试。',
    )), { once: true });
  });
  const unexpectedExit = exited.then(({ code, signal, error }) => {
    throw backendError(
      'SATELLITE_STARTUP_EXIT',
      `卫星服务无法启动（${error?.code || signal || code}）。${transcript.trim() ? `\n\n${transcript.trim()}` : ''}`,
      error,
    );
  });
  const healthy = announced.then(async (apiOrigin) => {
    while (!startup.signal.aborted) {
      try {
        const response = await fetch(`${apiOrigin}/api/health`, {
          signal: AbortSignal.any([startup.signal, AbortSignal.timeout(1_000)]),
        });
        if (response.ok && (await response.json()).status === 'ok') return apiOrigin;
      } catch {
        // The socket can be announced before Uvicorn starts serving requests.
      }
      await delay(80, undefined, { signal: startup.signal });
    }
  });

  try {
    const apiOrigin = await Promise.race([healthy, unexpectedExit, timedOut]);
    return { apiOrigin, stop, exited };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timer);
    startup.abort();
  }
}

module.exports = { startSatellite };
