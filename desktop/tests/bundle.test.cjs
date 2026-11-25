const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const bundle = require('../shell/bundle.cjs');

test('serves only staged assets from the same desktop origin', () => {
  const root = path.resolve('site');
  assert.equal(bundle.siteFile(root, 'app://desktop/'), path.join(root, 'index.html'));
  assert.equal(bundle.siteFile(root, 'app://desktop/assets/my%20file.js?x=1'), path.join(root, 'assets', 'my file.js'));
  assert.equal(bundle.siteFile(root, 'app://desktop/%2e%2e%2fpackage.json'), null);
  assert.equal(bundle.siteFile(root, 'app://desktop/assets%5c..%5cindex.html'), null);
  assert.equal(bundle.siteFile(root, 'app://desktop/NUL'), null);
  assert.equal(bundle.siteFile(root, 'app://other/index.html'), null);
});

test('injects the desktop layer behind the staged app styles and preserves app scripts', () => {
  const html = '<html><head><link href="main.css"></head><body><script src="main.js"></script></body></html>';
  const layered = bundle.layerHtml(html, true);
  assert.ok(layered.includes('href="main.css"><link rel="stylesheet" href="/desktop.css">'));
  assert.ok(layered.includes('src="main.js"></script><script defer src="/desktop.js"></script>'));
  assert.ok(!bundle.layerHtml(html, false).includes('desktop.js'));
});
