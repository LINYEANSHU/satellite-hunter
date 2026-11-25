const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const pythonVersion = '3.13.17';
const pythonArchive = `python-${pythonVersion}-embed-amd64.zip`;
const pythonChecksum = '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38';

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function patchFile(file, edits) {
  let contents = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
  for (const [before, after] of edits) {
    if (!contents.includes(before)) throw new Error(`Desktop build anchor missing in ${file}: ${before}`);
    contents = contents.replace(before, after);
  }
  await fs.writeFile(file, contents);
}

async function stageFrontend(project, work, target, installDependencies) {
  const frontend = path.join(project, 'frontend');
  const assets = ['index.html', 'package.json', 'package-lock.json', 'postcss.config.js', 'tailwind.config.js', 'tsconfig.json', 'vite.config.ts', 'src', 'public'];
  await Promise.all(assets.map((item) => fs.cp(path.join(frontend, item), path.join(work, item), { recursive: true })));

  const src = path.join(work, 'src');
  await patchFile(path.join(src, 'pages', 'MainMenuPage.tsx'), [
    ['className="h-full flex flex-col bg-ground-0 overflow-auto"', 'className="desktop-menu h-full flex flex-col bg-ground-0 overflow-auto"'],
    ['className="flex-1 grid grid-cols-1 lg:grid-cols-5 min-h-[440px]"', 'className="desktop-menu-hero grid"'],
    ['className="lg:col-span-3 flex flex-col justify-center px-8 lg:px-14 py-10"', 'className="desktop-menu-intro flex min-w-0 flex-col justify-center"'],
    [
      'className="font-semibold text-ink rise"\n            style={{ fontSize: \'clamp(2rem, 6vw, 4.5rem)\', lineHeight: 1.02, letterSpacing: \'-0.02em\' }}',
      'className="desktop-menu-title font-semibold text-ink rise"',
    ],
    ['className="lg:col-span-2 relative min-h-[320px] overflow-hidden"', 'className="desktop-menu-photo relative overflow-hidden"'],
    ['className="px-8 lg:px-14 pt-4 bg-ground-0 grid grid-cols-3 gap-3"', 'className="desktop-menu-strip pt-4 bg-ground-0 grid grid-cols-3 gap-3"'],
    ['className="px-8 lg:px-14 pb-3 pt-6 bg-ground-0"', 'className="desktop-menu-saves pb-3 bg-ground-0"'],
    ['className="px-8 lg:px-14 pb-4 pt-3 text-[13px] text-ink-dim"', 'className="desktop-menu-footer pb-4 pt-3 text-[13px] text-ink-dim"'],
  ]);

  // The desktop shell uses SwiftShader. Keep raster work bounded at large sizes and high DPI.
  await patchFile(path.join(src, 'three', 'GlobeScene.tsx'), [
    ["antialias: true, powerPreference: 'high-performance'", 'antialias: false'],
    ['dpr={[1, 2]}', 'dpr={1}'],
  ]);
  await patchFile(path.join(src, 'three', 'StationScene.tsx'), [
    ['antialias: true', 'antialias: false'],
    ['dpr={[1, 2]}', 'dpr={1}'],
  ]);
  await patchFile(path.join(src, 'three', 'FrameDriver.tsx'), [
    ['let unmounted = false', 'let unmounted = false\n    let lastDraw = -Infinity'],
    ['if (unmounted) return\n      callbacks.forEach', 'const now = performance.now()\n      if (unmounted || document.hidden || now - lastDraw < 1000 / hz - 1) return\n      lastDraw = now\n      callbacks.forEach'],
  ]);

  const modules = path.join(work, 'node_modules');
  await installDependencies(frontend, work);
  run(process.execPath, [path.join(modules, 'typescript', 'bin', 'tsc'), '-b'], work);
  run(process.execPath, [path.join(modules, 'vite', 'bin', 'vite.js'), 'build', '--outDir', path.join(target, 'site')], work);
}

async function stageBackend(project, target, cache) {
  const backend = path.join(target, 'backend');
  const python = path.join(backend, 'python');
  const pythonExe = path.join(python, 'python.exe');
  const source = path.join(project, 'backend');
  const requirementsText = (await fs.readFile(path.join(source, 'requirements.txt'), 'utf8'))
    .split(/\r?\n/).filter((line) => !/^pytest\b/i.test(line.trim())).join('\n');
  const requirementHash = sha256(requirementsText);
  const requirements = path.join(cache, `satellite-requirements-${requirementHash.slice(0, 12)}.txt`);
  const archive = path.join(cache, pythonArchive);

  await fs.mkdir(python, { recursive: true });
  if (!(await exists(archive))) {
    run('curl.exe', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '180', '--output', archive, `https://www.python.org/ftp/python/${pythonVersion}/${pythonArchive}`], cache);
  }
  if (sha256(await fs.readFile(archive)) !== pythonChecksum) throw new Error(`CPython archive checksum mismatch: ${archive}`);
  run('tar.exe', ['-xf', archive, '-C', python], backend);

  await fs.writeFile(requirements, requirementsText);
  await fs.cp(path.join(source, 'app'), path.join(backend, 'app'), {
    recursive: true,
    filter: (file) => path.basename(file) !== '__pycache__' && !file.endsWith('.pyc'),
  });
  await fs.copyFile(path.join(__dirname, 'desktop-server.py'), path.join(backend, 'desktop-server.py'));
  await fs.mkdir(path.join(target, 'docs'), { recursive: true });
  await fs.copyFile(path.join(project, 'docs', 'satdump.md'), path.join(target, 'docs', 'satdump.md'));

  // Keep optional SatDump/WSL discovery and execution from flashing a console.
  const src = path.join(backend, 'app');
  await patchFile(path.join(src, 'api', 'routes', 'system.py'), [
    ['            shell=False,', '            shell=False,\n            creationflags=subprocess.CREATE_NO_WINDOW,'],
    ['settings.frontend_dist.exists(),', '(settings.frontend_dist.parent.parent / "site" / "index.html").is_file(),'],
  ]);
  await patchFile(path.join(src, 'services', 'satdump', 'adapter.py'), [
    ['            shell=False,', '            shell=False,\n            creationflags=subprocess.CREATE_NO_WINDOW,'],
    ['                    shell=False,', '                    shell=False,\n                    creationflags=subprocess.CREATE_NO_WINDOW,'],
  ]);

  const wheels = path.join(python, 'packages');
  const uvArgs = [
    'pip', 'install', '--no-config', '--only-binary', ':all:', '--link-mode', 'copy',
    '--default-index', 'https://pypi.org/simple', '--cache-dir', path.join(cache, 'satellite-uv'),
    '--python', pythonExe, '--target', wheels, '-r', requirements,
  ];
  const uvCache = path.join(cache, `satellite-python-${pythonVersion}`);
  const receipt = path.join(uvCache, 'runtime.sha256');
  const warmed = await fs.readFile(receipt, 'utf8').catch(() => '');
  if (warmed.trim() === requirementHash) {
    await fs.cp(path.join(uvCache, 'packages'), wheels, { recursive: true });
  } else {
    run('uv.exe', uvArgs, backend);
  }
  // Embedded Python searches only these packaged paths, even if the computer has Python installed.
  await fs.writeFile(path.join(python, 'python313._pth'), 'python313.zip\n.\npackages\n..\n');
  run(pythonExe, ['-B', '-c', 'import app.main, numpy, scipy.signal, sgp4.api, sqlite3, uvicorn'], backend);
}

async function stageSatellite({ project, target, cache, installDependencies }) {
  await fs.mkdir(cache, { recursive: true });
  const work = await fs.mkdtemp(path.join(cache, 'satellite-frontend-'));
  try {
    await stageFrontend(project, work, target, installDependencies);
    await stageBackend(project, target, cache);
  } finally {
    if (path.dirname(path.resolve(work)) !== path.resolve(cache)) throw new Error(`Invalid frontend staging directory: ${work}`);
    await fs.rm(work, { recursive: true, force: true, maxRetries: 2 });
  }
}

module.exports = { stageSatellite };
