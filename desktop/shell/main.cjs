const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { desktopUrl, siteFile } = require('./bundle.cjs');
const config = require('./app.json');

const profile = app.commandLine.getSwitchValue('user-data-dir')
  || path.join(app.getPath('appData'), 'Entertainment Desktop', config.id);
const sessionData = path.join(profile, 'Chromium');
fs.mkdirSync(sessionData, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', sessionData);
app.setAppUserModelId('LINYEANSHU.EntertainmentDesktop.' + config.id);
app.setName(config.name);

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-direct-composition');
if (config.webgl) {
  // The packaged apps render their local assets with ANGLE's software implementation.
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
  app.disableHardwareAcceleration();
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const root = path.join(__dirname, 'site');
let backend;
let window;

async function proxyApi(request, url) {
  if (!backend) return new Response('API unavailable', { status: 503 });
  const target = new URL(backend.apiOrigin);
  target.pathname = url.pathname;
  target.search = url.search;
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'if-none-match', 'range']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  const options = { method: request.method, headers, redirect: 'manual' };
  if (request.body) {
    options.body = request.body;
    options.duplex = 'half';
  }
  try {
    const result = await fetch(target, options);
    const responseHeaders = new Headers(result.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  } catch (error) {
    if (!request.signal.aborted) console.error('Satellite API:', error.message);
    return Response.json({ detail: 'The local Satellite Hunter service is unavailable.' }, { status: 502 });
  }
}

function installProtocol() {
  protocol.handle('app', async request => {
    const url = desktopUrl(request.url);
    if (!url) return new Response('Unknown origin', { status: 403 });
    if (config.backend && url.pathname.startsWith('/api/')) return proxyApi(request, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    const file = siteFile(root, request.url);
    if (!file) return new Response('Invalid asset path', { status: 400 });
    try {
      const headers = new Headers();
      if (request.headers.has('range')) headers.set('range', request.headers.get('range'));
      return await net.fetch(pathToFileURL(file).href, { headers, method: request.method });
    } catch {
      return new Response('Asset not found', { status: 404 });
    }
  });
}

function openExternal(address) {
  const url = new URL(address);
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    shell.openExternal(url.href).catch(error => console.error('Open link:', error.message));
  }
}

function appPermission(permission) {
  return permission === 'clipboard-sanitized-write'
    || (config.id === 'world-generator' && permission === 'pointerLock');
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 640,
    title: config.name,
    backgroundColor: config.background,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  window.webContents.on('will-navigate', (event, address) => {
    if (desktopUrl(address)) return;
    event.preventDefault();
    openExternal(address);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('context-menu', (_event, props) => {
    const roles = props.isEditable ? ['cut', 'copy', 'paste', 'selectAll'] : ['copy'];
    if (props.isEditable || props.selectionText) {
      Menu.buildFromTemplate(roles.map(role => ({ role }))).popup({ window });
    }
  });
  window.on('page-title-updated', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = undefined; });
  return window.loadURL('app://desktop/');
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!backend) return;
  event.preventDefault();
  const service = backend;
  backend = undefined;
  service.stop().catch(error => console.error('Satellite shutdown:', error.message)).finally(() => app.quit());
});
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const address = details.requestingUrl || contents?.getURL();
      callback(appPermission(permission) && Boolean(address && desktopUrl(address)));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) =>
      appPermission(permission) && origin === 'app://desktop');
    if (config.backend) {
      const { startSatellite } = require('./satellite.cjs');
      backend = await startSatellite({ appRoot: __dirname, userData: profile });
    }
    installProtocol();
    await createWindow();
  }).catch(error => {
    console.error(error);
    dialog.showErrorBox(config.name, '应用启动失败 / Unable to start\n\n' + error.message);
    app.quit();
  });
}
