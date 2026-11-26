const assert = require('node:assert/strict');

module.exports = async ({ evaluate, send, wait, waitUntil }) => {
  const health = await evaluate("fetch('/api/health').then(r => r.ok)");
  assert.ok(health, 'Bundled backend serves health via the desktop origin');
  const saved = await evaluate("fetch('/api/saves', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({name:'Desktop smoke'}) }).then(r => r.json())");
  assert.ok(saved.id && saved.name === 'Desktop smoke');
  const station = await evaluate(`fetch('/api/stations', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ save_id: ${JSON.stringify(saved.id)}, name: 'QA station', lat: 43.6, lon: -63.6 }),
  }).then(r => r.json())`);
  assert.ok(station.id, 'The station was saved to the packaged backend');
  await evaluate("localStorage.removeItem('sh-save')");
  await send('Page.reload');
  await wait("document.querySelector('[data-testid=resume-save]')?.textContent.includes('Desktop smoke')");
  await evaluate("document.querySelector('[data-testid=resume-save]').click()");
  await wait("document.querySelector('[data-testid=globe-canvas] canvas')");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('sh-save')).saveId"), saved.id);
  await wait("document.querySelector('.time-bar button')");
  const pauseLabel = await evaluate("document.querySelector('.time-bar button').ariaLabel");
  await evaluate("document.querySelector('.time-bar button').click()");
  const playLabel = await evaluate("document.querySelector('.time-bar button').ariaLabel");
  assert.notEqual(playLabel, pauseLabel);
  await evaluate("location.hash = '#/'");
  await wait("document.querySelector('[data-testid=resume-save]')");
  await send('Page.reload');
  await wait("document.querySelector('[data-testid=resume-save]')");
  await evaluate("document.querySelector('[data-testid=resume-save]').click()");
  await wait(`document.querySelector('.time-bar button')?.ariaLabel === ${JSON.stringify(playLabel)}`);
  await evaluate("location.hash = '#/missions'");
  await wait("document.querySelector('[data-testid=new-mission-btn]')");
  await evaluate("document.querySelector('[data-testid=new-mission-btn]').click()");
  await wait("document.querySelector('[data-testid=create-mission-modal] option[value=low_angle]')");
  await evaluate(`(() => {
    const selector = document.querySelector('[data-testid=create-mission-modal] option[value=low_angle]').parentElement;
    selector.value = 'low_angle';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("document.querySelector('[data-testid=create-mission-modal]').textContent.includes('18°')");
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('[data-testid=create-mission-modal] option')).some(option => option.value === ${JSON.stringify(station.id)})`));
  await evaluate("location.hash = '#/explorer'");
  await wait("document.querySelector('[data-testid=globe-canvas] canvas')");
  const orbit = await evaluate("fetch('/api/satellites?group=stations&limit=1', {signal: AbortSignal.timeout(25000)}).then(async r => ({ status: r.status, body: await r.json() })).catch(e => ({error: e.message}))");
  assert.equal(orbit.status, 200, 'Stations are available even without network');
  assert.ok(orbit.body.total > 0 && orbit.body.items.length === 1);
  const group = await evaluate("fetch('/api/satellites/groups').then(r => r.json()).then(rows => rows.find(row => row.group === 'stations'))");
  assert.ok(group.source && group.newest_epoch);
  if (process.env.SH_ORBIT_SMOKE_LIVE === '1') {
    await waitUntil(
      () => evaluate("fetch('/api/satellites/groups').then(r => r.json()).then(gs => ['weather','amateur'].every(id => gs.some(g => g.group === id && !g.bundled && /SatNOGS/.test(g.source || ''))))"),
      'startup background refresh writes both SatNOGS caches', 35000,
    );
  }
  const publicGroups = {};
  const offline = process.env.SH_ORBIT_OFFLINE === 'true';
  for (const [category, id] of [['weather', 43013], ['amateur', 27607]]) {
    const catalog = await evaluate(`fetch('/api/satellites?group=${category}').then(r => r.json())`);
    if (offline) assert.equal(catalog.bundled, true, category + ' loads the bundled snapshot');
    const info = catalog.items.find(item => item.norad_id === id);
    assert.ok(info?.epoch && catalog.source);
    const position = await evaluate(`fetch('/api/satellites/positions?group=${category}&ids=${id}&at=' + encodeURIComponent(${JSON.stringify(info.epoch)})).then(r => r.json())`);
    assert.equal(position.items?.[0]?.[0], id);
    const passes = await evaluate(`fetch('/api/satellites/${id}/passes?lat=44.65&lon=-63.57&hours=48&at=' + encodeURIComponent(${JSON.stringify(info.epoch)})).then(r => r.json())`);
    assert.ok(passes.passes?.length, category + ' computes offline passes');
    await evaluate(`document.querySelector('[data-testid=group-${category}]').click()`);
    await wait(`document.querySelector('[data-testid=sat-${id}]') && /SatNOGS|EUMETSAT/.test(document.querySelector('[data-testid=catalog-source]')?.textContent)`);
    publicGroups[category] = { count: catalog.total, source: catalog.source, bundled: catalog.bundled, passes: passes.passes.length };
  }
  const natural = await evaluate("fetch('/api/solar/catalog?limit=1').then(r => r.json())");
  assert.deepEqual(natural.counts, { planet: 8, asteroid: 16000, comet: 3918 });
  const earth = await evaluate("fetch('/api/solar/trajectory/planet-earth?at=2026-11-25T00:00Z&points=24').then(r => r.json())");
  assert.equal(earth.path_au.length, 24);
  assert.ok(earth.distance_au > 0.9 && earth.distance_au < 1.1);
  await evaluate("location.hash = '#/solar'");
  await wait("document.querySelector('h1')?.textContent.match(/Solar System|太阳系/)");
  await wait("document.querySelector('canvas') || document.querySelector('svg[role=img]')");
  return { resumedSave: true, lowAngleMission: true, orbitStatus: orbit.status, orbitTotal: orbit.body.total,
    orbitSource: group.source, orbitBundled: group.bundled, orbitEpoch: group.newest_epoch, solarCounts: natural.counts, publicGroups };
};
