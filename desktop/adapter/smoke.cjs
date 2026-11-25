const assert = require('node:assert/strict');

module.exports = async ({ evaluate, send, wait }) => {
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
  if (orbit.status === 200) assert.ok(orbit.body.total > 0 && orbit.body.items.length === 1);
  else assert.match(JSON.stringify(orbit), /ORBIT_DATA_UNAVAILABLE/);
  return { resumedSave: true, lowAngleMission: true, orbitStatus: orbit.status, orbitTotal: orbit.body?.total ?? null };
};
