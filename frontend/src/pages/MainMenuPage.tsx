import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Capabilities } from '../api/client'
import { gameApi, type SaveInfo } from '../api/game'
import { useGameStore } from '../stores/gameStore'
import Icon from '../components/Icon'
import { sfx } from '../lib/sfx'

/** 主菜单：唯一的 Persuade 门面 —— 地球实拍 + 存档管理。 */
export default function MainMenuPage() {
  const nav = useNavigate()
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [saves, setSaves] = useState<SaveInfo[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const setSession = useGameStore((s) => s.setSession)

  const refresh = useCallback(() => {
    api.capabilities().then(setCaps).catch((e) => setError(e.message))
    gameApi.saves().then(setSaves).catch((e) => setError(e.message))
  }, [])

  useEffect(refresh, [refresh])

  const enter = (s: SaveInfo) => {
    sfx.click()
    setSession({
      saveId: s.id,
      saveName: s.name,
      credits: s.credits,
      researchPoints: s.research_points,
      level: s.level,
      totalMissionsDone: s.total_missions_done,
      satellitesDiscovered: s.satellites_discovered,
    })
    nav('/explorer')
  }

  const create = async () => {
    if (!newName.trim()) return
    try {
      const s = await gameApi.createSave(newName.trim())
      setNewName('')
      refresh()
      enter({
        ...s,
        last_played_at: null,
        credits: 5000,
        research_points: 0,
        level: 1,
        total_missions_done: 0,
        satellites_discovered: 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="h-full flex flex-col bg-ground-0 overflow-auto">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 min-h-[440px]">
        {/* 左：主张与行动 */}
        <div className="lg:col-span-3 flex flex-col justify-center px-8 lg:px-14 py-10">
          <h1
            className="font-semibold text-ink rise"
            style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)', lineHeight: 1.02, letterSpacing: '-0.02em' }}
          >
            追踪真实的卫星，
            <br />
            从一座地面站开始。
          </h1>
          <p className="mt-6 text-[16px] text-ink-dim leading-relaxed max-w-lg rise" style={{ animationDelay: '80ms' }}>
            Satellite Hunter 把真实轨道数据变成一场运营游戏：预测过境、规划接收、
            解读频谱，把一台入门接收机经营成全球观测网络。
          </p>
          <div className="mt-8 flex items-center gap-4 rise" style={{ animationDelay: '160ms' }}>
            <button className="btn-solid h-11 px-6 text-[15px]" onClick={() => nav('/explorer')} data-testid="enter-explorer">
              直接进入
            </button>
            <span className="text-[13px] text-ink-dim">无需硬件，核心体验完整可玩</span>
          </div>

          <div
            className="mt-9 flex items-center gap-5 text-[13px] text-ink-dim rise"
            style={{ animationDelay: '240ms' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span className={`status-dot ${error ? 'bg-danger' : 'bg-ok'}`} />
              服务{error ? '未连接' : '正常'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              SatDump
              <span className={caps?.satdump.installed ? 'text-ok' : 'text-warn'}>
                {caps ? (caps.satdump.installed ? '已就绪' : '未安装') : '—'}
              </span>
            </span>
            {caps && <span className="data">v{caps.app.version}</span>}
          </div>
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </div>

        {/* 右：地球实拍（NASA 公有领域），占满右列 */}
        <div className="lg:col-span-2 relative min-h-[320px] overflow-hidden">
          <img
            src="/photos/blue-marble-western-hemisphere.jpg"
            alt="Blue Marble：NASA 从轨道拍摄的地球全景"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </div>

      {/* 真实世界影像带 */}
      <div className="px-8 lg:px-14 pt-4 bg-ground-0 grid grid-cols-3 gap-3">
        {[
          { src: '/photos/sts-134-international-space-station-after-undocking.jpg', alt: '国际空间站实拍', label: '国际空间站（追踪目标）' },
          { src: '/photos/erdfunkstelle-raisting-2.jpg', alt: 'Raisting 28.5 米抛物面天线', label: '28.5m 抛物面天线' },
          { src: '/photos/antennas-at-awarua-satellite-ground-station.jpg', alt: 'Awarua 卫星地面站天线阵', label: 'Awarua 地面站' },
        ].map((ph, i) => (
          <div key={ph.src} className="relative rounded-lg overflow-hidden h-24 lg:h-28 rise" style={{ animationDelay: `${i * 70}ms` }}>
            <img src={ph.src} alt={ph.alt} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-ground-0/60 px-2.5 py-1 text-[13px] text-ink/90">{ph.label}</div>
          </div>
        ))}
      </div>

      {/* 存档：行式列表 */}
      <div className="px-8 lg:px-14 pb-3 pt-6 bg-ground-0">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-[17px] font-semibold text-ink">存档</h2>
              <span className="text-[13px] text-ink-dim">{saves.length} 个</span>
            </div>
            {saves.length === 0 && (
              <p className="text-[14px] text-ink-dim py-3">还没有存档——起个名字开始你的运营生涯。</p>
            )}
            {saves.map((s, i) => (
              <div
                key={s.id}
                className="row rounded-md mb-1 bg-ground-1 rise"
                style={{ animationDelay: `${i * 60}ms` }}
                data-testid={`save-${s.name}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] text-ink">{s.name}</div>
                  <div className="text-[13px] text-ink-dim mt-0.5">
                    <span className="data">Lv.{s.level}</span> ·{' '}
                    <span className="data text-warn">₡{Math.round(s.credits).toLocaleString()}</span> · 任务{' '}
                    {s.total_missions_done} · 发现 {s.satellites_discovered} 颗
                    {s.last_played_at && ` · 上次 ${new Date(s.last_played_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button className="btn btn-primary h-8 text-[13px]" onClick={() => enter(s)}>
                  进入
                </button>
                <button
                  className="btn btn-danger w-9 px-0 h-8"
                  title="删除存档"
                  onClick={async () => {
                    if (confirm(`删除存档「${s.name}」？此操作不可恢复。`)) {
                      await gameApi.deleteSave(s.id)
                      refresh()
                    }
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <input
                className="input max-w-xs !h-9"
                placeholder="新存档名称…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                data-testid="new-save-input"
              />
              <button className="btn !h-9" onClick={() => void create()} data-testid="create-save">
                <Icon name="plus" size={14} />
                新建存档
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col justify-center">
            <h3 className="text-[17px] font-semibold text-ink mb-2">为什么这些数据是真的？</h3>
            <p className="text-[15px] text-ink-dim leading-relaxed">
              游戏里的每一颗卫星都来自 CelesTrak 的真实轨道根数，SGP4 传播与
              Skyfield 交叉验证；多普勒由真实距离变化率计算；接收结果由链路
              预算决定，而不是掷骰子。你练出来的是真的能用的技能。
            </p>
          </div>
        </div>
      </div>

      {/* 照片署名（许可要求） */}
      <footer className="px-8 lg:px-14 pb-4 pt-3 text-[13px] text-ink-dim">
        影像：
        <a
          className="hover:text-ink"
          href="https://commons.wikimedia.org/wiki/File:Blue_Marble_Western_Hemisphere.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Blue Marble
        </a>{' '}
        (NASA, 公有领域) ·{' '}
        <a
          className="hover:text-ink"
          href="https://commons.wikimedia.org/wiki/File:Antennas_at_Awarua_Satellite_Ground_Station.jpg"
          target="_blank"
          rel="noreferrer"
        >
          Awarua Ground Station
        </a>{' '}
        (Satopsnz, CC BY-SA 4.0)，via Wikimedia Commons
      </footer>
    </div>
  )
}
