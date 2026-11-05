import { useEffect, useState } from 'react'
import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { api, type Capabilities } from './api/client'
import { useGameStore, useTimeStore } from './stores/gameStore'
import TimeBar from './components/TimeBar'
import GameNotifications, { TutorialOverlay } from './components/GameNotifications'
import PassReminder from './components/PassReminder'
import Icon from './components/Icon'
import LanguageToggle from './components/LanguageToggle'
import { useLang } from './i18n'
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
import { sfxToggleMute } from './lib/sfx'

const NAV_KEYS = [
  { to: '/explorer', key: 'explorer', icon: 'satellite' },
  { to: '/station', key: 'station', icon: 'dish' },
  { to: '/equipment', key: 'equipment', icon: 'wrench' },
  { to: '/missions', key: 'missions', icon: 'route' },
  { to: '/signallab', key: 'signallab', icon: 'wave' },
  { to: '/codex', key: 'codex', icon: 'book' },
  { to: '/achievements', key: 'achievements', icon: 'trophy' },
  { to: '/settings', key: 'settings', icon: 'gear' },
] as const

function Shell() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const saveName = useGameStore((s) => s.saveName)
  const [muteState, setMuteState] = useState(sfxMutedState())
  const { t } = useLang()

  // 键盘快捷键：空格暂停，1-4 倍速，N 回到现在
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const t = useTimeStore.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        t.setPaused(!t.paused)
      } else if (e.key === '1') t.setScale(1)
      else if (e.key === '2') t.setScale(10)
      else if (e.key === '3') t.setScale(60)
      else if (e.key === '4') t.setScale(1000)
      else if (e.key.toLowerCase() === 'n') t.resetToReal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 刷新存档后从服务器同步一次资源显示（localStorage 只恢复上下文不恢复数值）
  const saveId = useGameStore((s) => s.saveId)
  useEffect(() => {
    if (!saveId) return
    api
      .capabilities()
      .then(setCaps)
      .catch(() => setBackendDown(true))
    import('./api/game').then(({ gameApi }) =>
      gameApi
        .state(saveId)
        .then((st) =>
          useGameStore.getState().setSession({
            credits: st.player.credits,
            researchPoints: st.player.research_points,
            xp: st.player.xp,
            level: st.player.level,
            totalMissionsDone: st.player.total_missions_done,
            satellitesDiscovered: st.player.satellites_discovered,
          }),
        )
        .catch(() => {}),
    )
  }, [saveId])

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <header className="h-12 flex items-center px-4 gap-3 bg-ground-1">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <Icon name="signal" size={16} className="text-signal" />
          <span className="font-semibold text-[14px] text-ink group-hover:text-signal transition-colors">
            Satellite Hunter
          </span>
          <span className="text-ink-dim text-[11px] hidden lg:inline">Ground Station</span>
        </NavLink>
        <div className="flex-1" />
        {saveName && (
          <span className="text-[12px] text-ink-dim">
            <Icon name="archive" size={12} className="inline mr-1 -mt-0.5" />
            {saveName}
          </span>
        )}
        <StatusBar caps={caps} backendDown={backendDown} />
        <LanguageToggle />
        <button
          className="text-ink-dim hover:text-ink p-1.5"
          title={muteState ? t.topbar.soundOn : t.topbar.soundOff}
          onClick={() => setMuteState(sfxToggleMute())}
        >
          <Icon name={muteState ? 'mute' : 'sound'} size={15} />
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 左侧导航 */}
        <nav className="w-14 flex flex-col items-center gap-0.5 py-2 bg-ground-1">
          {NAV_KEYS.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={t.nav[n.key]}
              className={({ isActive }) =>
                `w-10 h-10 rounded-md flex items-center justify-center transition-colors ${
                  isActive
                    ? 'bg-ground-3 text-signal border-l-2 border-l-signal'
                    : 'text-ink-dim hover:text-ink hover:bg-ground-2'
                }`
              }
            >
              <Icon name={n.icon} size={19} />
            </NavLink>
          ))}
          <div className="flex-1" />
          <NavLink
            to="/"
            title={t.nav.mainMenu}
            className="w-10 h-10 rounded-md flex items-center justify-center text-ink-dim hover:text-ink hover:bg-ground-2"
          >
            <Icon name="home" size={19} />
          </NavLink>
        </nav>

        {/* 内容区 */}
        <main className="flex-1 min-w-0 p-3 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0">
            <Outlet />
          </div>
        </main>
      </div>

      {/* 全局时间控制 */}
      <TimeBar />

      <GameNotifications />
      <PassReminder />
      <TutorialOverlay />
    </div>
  )
}

function sfxMutedState() {
  return localStorage.getItem('sh-sfx-muted') === '1'
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
