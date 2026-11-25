const assert = require('node:assert/strict');

module.exports = async ({ evaluate, wait }) => {
  const health = await evaluate("fetch('/api/health').then(r => r.ok)");
  assert.ok(health, 'Bundled backend serves health via the desktop origin');
  const saved = await evaluate("fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({name:'Desktop smoke'}) }).then(r => r.json())");
  assert.ok(saved.id && saved.name === 'Desktop smoke');
  await wait("document.querySelector('[data-testid=enter-explorer]')");
  await evaluate("document.querySelector('[data-testid=enter-explorer]').click()");
  await wait("document.querySelector('[data-testid=globe-canvas] canvas')");
  const orbit = await evaluate("fetch('/api/satellites?group=stations&limit=1', {signal: AbortSignal.timeout(25000)}).then(async r => ({ status: r.status, body: await r.json() })).catch(e => ({error: e.message}))");
  if (orbit.status === 200) assert.ok(orbit.body.total > 0 && orbit.body.items.length === 1);
  else assert.match(JSON.stringify(orbit), /ORBIT_DATA_UNAVAILABLE/);
  return { orbitStatus: orbit.status, orbitTotal: orbit.body?.total ?? null };
};
