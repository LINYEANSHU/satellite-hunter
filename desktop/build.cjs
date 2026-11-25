const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const { layerHtml } = require('./shell/bundle.cjs');

const desktop = __dirname;
const workspace = path.dirname(desktop);
const standalone = fs.existsSync(path.join(desktop, 'app.json'));
const apps = standalone ? [require('./app.json')] : require('./apps.json');
const cache = path.resolve(process.env.DESKTOP_BUILD_CACHE || path.join(desktop, '.cache'));
const output = path.join(desktop, 'dist');
const electronVersion = '45.5.0';
const release = 'https://github.com/electron/electron/releases/download/v' + electronVersion;
const runtimeArchive = 'electron-v' + electronVersion + '-win32-x64.zip';
const checksums = 'electron-' + electronVersion + '-SHASUMS256.txt';
const resourceEditor = process.env.DESKTOP_RCEDIT;

function run(exe, args, cwd = desktop, env = process.env) {
  const { error, status } = spawnSync(exe, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (error) throw error;
  if (status !== 0) throw new Error(exe + ' exited with status ' + status);
}

async function present(file) {
  return fsp.access(file).then(() => true, () => false);
}

function inside(parent, child) {
  const relative = path.relative(parent, path.resolve(child));
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

async function removeGenerated(parent, child) {
  if (!inside(parent, child)) throw new Error('Generated directory escaped ' + parent);
  const info = await fsp.lstat(child).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) return;
  if (info.isSymbolicLink()) throw new Error('Refusing to replace a linked directory: ' + child);
  await fsp.rm(child, { recursive: true, force: true, maxRetries: 2 });
}

async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('data', chunk => hash.update(chunk));
  await finished(stream);
  return hash.digest('hex');
}

function download(url, target) {
  const partial = target + '.' + process.pid + '.partial';
  try {
    run('curl.exe', [
      '--fail', '--show-error', '--silent', '--location', '--retry', '2',
      '--connect-timeout', '20', '--max-time', '200', '--output', partial, url,
    ]);
    fs.renameSync(partial, target);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

async function electronRuntime() {
  const extracted = path.join(cache, 'electron-' + electronVersion + '-win32-x64');
  const archive = path.join(cache, runtimeArchive);
  const checksumFile = path.join(cache, checksums);
  if (await present(path.join(extracted, '.verified'))) return extracted;
  if (!(await present(checksumFile))) download(release + '/SHASUMS256.txt', checksumFile);
  if (!(await present(archive))) download(release + '/' + runtimeArchive, archive);
  const entry = (await fsp.readFile(checksumFile, 'utf8')).split(/\r?\n/)
    .find(line => line.trim().split(/\s+/)[1]?.replace(/^\*/, '') === runtimeArchive);
  if (!entry || await fileHash(archive) !== entry.split(' ')[0]) {
    throw new Error('Electron archive SHA-256 mismatch: ' + archive);
  }
  await removeGenerated(cache, extracted);
  await fsp.mkdir(extracted);
  run('tar.exe', ['-xf', archive, '-C', extracted]);
  if (!(await present(path.join(extracted, 'electron.exe')))) throw new Error('Electron runtime is incomplete.');
  await fsp.writeFile(path.join(extracted, '.verified'), entry + '\n');
  return extracted;
}

async function copyList(source, target, items) {
  await fsp.mkdir(target, { recursive: true });
  for (const item of items) {
    await fsp.cp(path.join(source, item), path.join(target, item), { recursive: true });
  }
}

async function installDependencies(project, work) {
  const dependencies = path.join(work, 'node_modules');
  const originalDeps = path.join(project, 'node_modules');
  if (await present(path.join(originalDeps, 'vite/bin/vite.js'))) {
    await fsp.cp(originalDeps, dependencies, { recursive: true, dereference: true });
    return;
  }
  const lockFile = path.join(work, 'package-lock.json');
  const lock = await fsp.readFile(lockFile, 'utf8');
  await fsp.writeFile(lockFile, lock.replaceAll('https://registry.npmmirror.com/', 'https://registry.npmjs.org/'));
  run('cmd.exe', ['/d', '/c', 'npm ci --no-audit --no-fund --registry=https://registry.npmjs.org'], work, {
    ...process.env,
    npm_config_cache: path.join(cache, 'npm'),
  });
}

async function buildVite(project, work, site) {
  const sourceFiles = await fsp.readdir(project);
  const files = sourceFiles.filter(item => /^(?:index\.html|package.*\.json|vite\.config\.[\w.]+|tsconfig[\w.]*\.json|src|public|assets)$/.test(item));
  await copyList(project, work, files);
  await installDependencies(project, work);
  run(process.execPath, [
    'node_modules/vite/bin/vite.js', 'build', '--base', './', '--outDir', site, '--emptyOutDir', '--logLevel', 'warn',
  ], work);
}

async function stageApp(config, runtime) {
  const adapter = standalone ? path.join(desktop, 'adapter') : path.join(desktop, 'apps', config.id);
  const project = path.join(workspace, config.source || '.');
  const stage = await fsp.mkdtemp(path.join(cache, config.id + '-'));
  const bundleDir = path.join(stage, config.exe);
  const target = path.join(bundleDir, 'resources', 'app');
  const site = path.join(target, 'site');

  try {
    console.log('\nBuilding ' + config.name);
    await fsp.mkdir(target, { recursive: true });
    if (config.backend) {
      const { stageSatellite } = require(path.join(adapter, 'build.cjs'));
      await stageSatellite({ project, target, cache, installDependencies });
      await fsp.copyFile(path.join(adapter, 'backend.cjs'), path.join(target, 'satellite.cjs'));
    } else if (config.vite) {
      await buildVite(project, path.join(stage, 'frontend'), site);
    } else {
      await copyList(project, site, config.static);
    }
    await fsp.copyFile(path.join(adapter, 'desktop.css'), path.join(site, 'desktop.css'));
    const hasScript = await present(path.join(adapter, 'desktop.js'));
    if (hasScript) await fsp.copyFile(path.join(adapter, 'desktop.js'), path.join(site, 'desktop.js'));
    const index = path.join(site, 'index.html');
    await fsp.writeFile(index, layerHtml(await fsp.readFile(index, 'utf8'), hasScript));
    await copyList(path.join(desktop, 'shell'), target, ['main.cjs', 'bundle.cjs']);
    await copyList(project, target, ['LICENSE']);
    if (await present(path.join(project, 'NOTICE'))) await copyList(project, target, ['NOTICE']);
    await fsp.writeFile(path.join(target, 'package.json'), JSON.stringify({
      name: config.id, productName: config.name, version: '1.0.0', main: 'main.cjs',
    }, null, 2) + '\n');
    await fsp.writeFile(path.join(target, 'app.json'), JSON.stringify(config) + '\n');
    const icon = path.join(target, 'icon.ico');
    if (standalone) {
      await fsp.copyFile(path.join(adapter, 'icon.ico'), icon);
    } else {
      run(process.env.DESKTOP_PYTHON || 'python.exe', [path.join(desktop, 'make-icon.py'), config.id, icon]);
    }
    await fsp.cp(runtime, bundleDir, {
      recursive: true,
      filter: item => !['default_app.asar', '.verified'].includes(path.basename(item)),
    });
    const exe = path.join(bundleDir, config.exe + '.exe');
    await fsp.rename(path.join(bundleDir, 'electron.exe'), exe);
    if (resourceEditor) {
      run(resourceEditor, [
        exe, '--set-icon', icon,
        '--set-version-string', 'FileDescription', config.name,
        '--set-version-string', 'ProductName', config.name,
        '--set-version-string', 'OriginalFilename', config.exe + '.exe',
      ]);
    }
    const delivery = path.join(output, config.exe);
    await removeGenerated(output, delivery);
    await fsp.rename(bundleDir, delivery);
    console.log(path.join(delivery, path.basename(exe)));
  } finally {
    await removeGenerated(cache, stage);
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build on Windows with x64 Node.js.');
  }
  const names = process.argv.slice(2);
  const selected = names.length ? names.map(id => {
    const app = apps.find(config => config.id === id);
    if (!app) throw new Error('Unknown project: ' + id);
    return app;
  }) : apps;
  await fsp.mkdir(cache, { recursive: true });
  await fsp.mkdir(output, { recursive: true });
  const runtime = await electronRuntime();
  for (const config of selected) await stageApp(config, runtime);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
