const path = require('node:path');

function desktopUrl(address) {
  const url = new URL(address);
  return url.protocol === 'app:' && url.host === 'desktop' && !url.username && !url.password
    ? url
    : null;
}

function siteFile(root, address) {
  const url = desktopUrl(address);
  if (!url) return null;
  let relative;
  try {
    relative = decodeURIComponent(url.pathname).slice(1) || 'index.html';
  } catch {
    return null;
  }
  const unsafe = /[\x00-\x1f\\:<>?"|*]|^(?:\.{1,2}|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)|[. ]$/i;
  if (relative.split('/').some(segment => !segment || unsafe.test(segment))) return null;
  return path.join(root, relative);
}

function layerHtml(html, hasScript) {
  if (!/<\/head>/i.test(html) || !/<\/body>/i.test(html)) {
    throw new Error('Expected a complete HTML document when adding the Windows UI.');
  }
  const styled = html.replace(/<\/head>/i, '<link rel="stylesheet" href="/desktop.css"></head>');
  return hasScript ? styled.replace(/<\/body>/i, '<script defer src="/desktop.js"></script></body>') : styled;
}

module.exports = { desktopUrl, siteFile, layerHtml };
