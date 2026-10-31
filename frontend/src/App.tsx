import { useEffect, useState } from 'react'
import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { api, type Capabilities } from './api/client'
import { startTimeTicker, useGameStore } from './stores/gameStore'
import MainMenuPage from './pages/MainMenuPage'
import ExplorerPage from './pages/ExplorerPage'
import StationPage from './pages/StationPage'
import EquipmentPage from './pages/EquipmentPage'
import MissionControlPage from './pages/MissionControlPage'
import SignalLabPage from './pages/SignalLabPage'
import CodexPage from './pages/CodexPage'
import AchievementsPage from './pages/AchievementsPage'
import SettingsPage from './pages/SettingsPage'
import StatusBar from './components/StatusBar'

const NAV = [
  { to: '/explorer', label: '轨道探索', icon: '🛰' },
  { to: '/station', label: '地面站', icon: '📡' },
  { to: '/equipment', label: '设备管理', icon: '🔧' },
  { to: '/missions', label: '任务控制', icon: '🗺' },
  { to: '/signallab', label: '信号实验室', icon: '📈' },
  { to: '/codex', label: '卫星图鉴', icon: '📖' },
  { to: '/achievements', label: '成就研究', icon: '🏆' },
  { to: '/settings', label: '系统状态', icon: '⚙' },
]

function Shell() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const saveName = useGameStore((s) => s.saveName)

  useEffect(() => {
    startTimeTicker()
    api
      .capabilities()
      .then(setCaps)
      .catch(() => setBackendDown(true))
  }, [])

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <header className="h-12 flex items-center px-4 gap-4 border-b border-space-600/60 bg-space-900/80">
        <NavLink to="/" className="flex items-center gap-2 group">
          <span className="text-hud-cyan text-lg leading-none animate-pulseSoft">◉</span>
          <span className="font-display font-semibold tracking-wider text-sm text-slate-100 group-hover:text-hud-cyan transition-colors">
            SATELLITE HUNTER
          </span>
          <span className="text-[10px] text-hud-dim tracking-widest">GROUND STATION</span>
        </NavLink>
        <div className="flex-1" />
        {saveName && <span className="chip text-hud-violet">存档: {saveName}</span>}
        <StatusBar caps={caps} backendDown={backendDown} />
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 左侧导航 */}
        <nav className="w-14 flex flex-col items-center gap-1 py-3 border-r border-space-600/60 bg-space-900/60">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              className={({ isActive }) =>
                `w-10 h-10 rounded flex items-center justify-center text-lg transition-colors ${
                  isActive
                    ? 'bg-hud-cyan/15 text-hud-cyan shadow-glow'
                    : 'text-hud-dim hover:text-slate-200 hover:bg-space-800'
                }`
              }
            >
              {n.icon}
            </NavLink>
          ))}
          <div className="flex-1" />
          <NavLink
            to="/"
            title="主菜单"
            className="w-10 h-10 rounded flex items-center justify-center text-lg text-hud-dim hover:text-slate-200 hover:bg-space-800"
          >
            ⌂
          </NavLink>
        </nav>

        {/* 内容区 */}
        <main className="flex-1 min-w-0 p-3 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainMenuPage />} />
      <Route element={<Shell />}>
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/station" element={<StationPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/missions" element={<MissionControlPage />} />
        <Route path="/signallab" element={<SignalLabPage />} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<MainMenuPage />} />
    </Routes>
  )
}
