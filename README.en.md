<p align="center">
  <img src="./assets/readme/hero-en.svg" width="100%" alt="Satellite Hunter: a ground-station simulator with real SGP4 orbits, pass prediction, link budgets and SatDump decoding">
</p>

<p align="center">
  <b>English</b> · <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/LINYEANSHU/satellite-hunter/actions/workflows/ci.yml"><img src="https://github.com/LINYEANSHU/satellite-hunter/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/node-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node 22+">
</p>

**Satellite Hunter** is a ground-station simulator built on real orbital data: every satellite comes from real CelesTrak two-line elements (TLE/GP) and is propagated with SGP4. Pass predictions, Doppler shift, and link budgets all follow real physics — while prices and rewards are game-balance values. The skills you practice here actually transfer.

## Gameplay loop

```
Place a station → Predict passes → Track & receive → Decode & analyze → Score · achievements · expand
```

1. **Place a station** — click anywhere on the 3D globe to build a ground station and set its minimum elevation;
2. **Predict passes** — SGP4 propagation plus a pass cache yields AOS/LOS times, peak elevation, and azimuths for the next 24–72 h;
3. **Track & receive** — the rotator follows the satellite live while you monitor azimuth/elevation, SNR, Doppler, and the data buffer;
4. **Decode & analyze** — import IQ recordings to inspect spectrum, waterfall, and constellation plots, or hand them to external SatDump for real decoding;
5. **Score · achievements · expand** — earn Credits and research points, unlock 36 achievements, and grow one station into a global observing network.

Fully playable without any radio hardware. Connect a real SDR recording and the same analysis pipeline applies.

## Highlights

- **Real orbit system** — CelesTrak GP/TLE fetches with a 2-hour cache floor, full SGP4 propagation, cross-checked against Skyfield during development
- **Pass prediction engine** — cached pass search (AOS/LOS/peak elevation/AOS & LOS azimuths) with automatic countdown alerts before each pass
- **Physically grounded reception** — link budgets decide outcomes (antenna gain, noise figure, band coverage, rotator pointing); seeded jitter keeps results reproducible (SIMULATED_RF)
- **Signal lab** — spectrum, waterfall, IQ waveform, and constellation plots; SatDump runs as an external process and its decoded products can be collected into your save
- **36 event-driven achievements** plus a research-perk system and a deterministic auto-scheduler
- **3D globe** — Three.js renders the Earth, live satellite positions, selection markers and trails, orbit lines, and ground stations

## Quick start

Prerequisites: Python 3.11+, Node.js 20+ (CI runs on Node 22). Optional: SatDump for real signal decoding — everything else works without it (see `docs/satdump.md`).

### One-command start

```sh
# Git Bash / Linux / macOS
./scripts/dev.sh
```

```bat
:: Windows (cmd)
scripts\dev.bat
```

The script creates the virtualenv, installs dependencies, and starts the backend (http://localhost:8000) plus the frontend (http://localhost:5273). Open **http://localhost:5273** in your browser.

### Manual setup

```sh
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```sh
# Frontend (second terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5273
```

### Tests

```sh
cd backend && python -m pytest -q     # backend unit/integration tests (77 tests)
cd frontend && npm run test           # frontend tests (vitest)
```

## Architecture at a glance

```
frontend (React + Three.js + Zustand)
   │  REST + WebSocket
backend (FastAPI)
   ├─ orbit/    CelesTrak GP fetch → disk cache → SGP4 propagation → pass search (cached)
   ├─ game/     saves, equipment catalog, mission scheduling, RF link model, achievements, events, research
   ├─ dsp/      recording import, spectrum / waterfall / constellation statistics
   └─ satdump/  adapter for the external SatDump process (Windows PATH / WSL)
SQLite saves (backend/data/ — all runtime data can be wiped and rebuilt at any time)
```

- **CelesTrak fetch** — GP data per group (space stations / weather / amateur / science / …), disk-cached with a minimum 2-hour refetch interval
- **SGP4 propagation** — batched position snapshots with frontend interpolation; no per-frame HTTP requests on the render hot path
- **Pass cache** — pass results per station × group × time are persisted, so repeated queries cost nothing
- **SatDump adapter** — detects a local SatDump binary (or WSL distro), submits decode jobs, and streams back logs and output files

For more detail see [docs/architecture.md](docs/architecture.md), [docs/orbit-data.md](docs/orbit-data.md), and [docs/api.md](docs/api.md).

## Documentation

- [Development plan & progress](DEVELOPMENT_PLAN.md)
- [Architecture](docs/architecture.md)
- [Orbit data sources](docs/orbit-data.md)
- [Gameplay](docs/gameplay.md)
- [API overview](docs/api.md) — the running backend also serves interactive docs at http://localhost:8000/docs
- [Known issues & roadmap](docs/known-issues.md)

## References & acknowledgements

- [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) — the SGP4/SDP4 propagation core
- [Skyfield](https://github.com/skyfielders/python-skyfield) — used to cross-validate orbital math during development
- [CelesTrak](https://celestrak.org/) — TLE/GP data source (thanks to Dr. T.S. Kelso)
- [SatDump](https://github.com/SatDump/SatDump) — external satellite decoding tool, integrated as a separate process (GPL-3.0; attribution in [docs/licenses.md](docs/licenses.md))
- [Three.js](https://github.com/mrdoob/three.js) and the React ecosystem — 3D globe visualization
- Page imagery from NASA (public domain) and Wikimedia Commons photographers (credits in the main-menu footer)

## License

Released under the [MIT License](LICENSE). Third-party components (SatDump and others) are integrated as separate processes and keep their own licenses.
