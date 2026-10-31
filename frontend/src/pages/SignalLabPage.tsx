import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  signalApi,
  uploadRecording,
  type RecordingInfo,
  type SatdumpJobView,
} from '../api/game'
import PageHeader from '../components/PageHeader'
import { ConstellationPlot, SpectrumPlot, WaveformPlot, WaterfallPlot } from '../components/SignalPlots'
import { useGameStore } from '../stores/gameStore'

type Tab = 'spectrum' | 'waterfall' | 'waveform' | 'constellation'

const FORMATS = [
  ['cf32', 'float32 (SatDump 默认)'],
  ['cs16', 'int16'],
  ['cu8', 'uint8 (RTL)'],
  ['cs8', 'int8'],
  ['cu16', 'uint16'],
]

/** 信号分析实验室（需求 6.1/6.2/6.3）。 */
export default function SignalLabPage() {
  const nav = useNavigate()
  const saveId = useGameStore((s) => s.saveId)
  const [recordings, setRecordings] = useState<RecordingInfo[]>([])
  const [selected, setSelected] = useState<RecordingInfo | null>(null)
  const [tab, setTab] = useState<Tab>('spectrum')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 回放进度（对离线录波：position = 采样偏移比例）
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playTimer = useRef<number | null>(null)

  // 数据
  const [spectrum, setSpectrum] = useState<{ db: number[]; freq_span_hz: number | null } | null>(null)
  const [waterfall, setWaterfall] = useState<{ db: number[][]; db_min: number; db_max: number; freq_span_hz: number | null } | null>(null)
  const [waveform, setWaveform] = useState<{ i: number[]; q: number[] } | null>(null)
  const [constellation, setConstellation] = useState<{ points: [number, number][] } | null>(null)
  const [stats, setStats] = useState<Record<string, number>>({})

  // 上传表单
  const [fmt, setFmt] = useState('cf32')
  const [srate, setSrate] = useState('48000')
  const [cfreq, setCfreq] = useState('137000000')

  // SatDump
  const [sdStatus, setSdStatus] = useState<Awaited<ReturnType<typeof signalApi.satdumpStatus>> | null>(null)
  const [pipelines, setPipelines] = useState<{ name: string; desc: string }[]>([])
  const [pipeline, setPipeline] = useState('')
  const [jobs, setJobs] = useState<SatdumpJobView[]>([])
  const [logText, setLogText] = useState('')

  const reloadList = useCallback(async () => {
    if (!saveId) return
    const list = await signalApi.list(saveId)
    setRecordings(list)
    return list
  }, [saveId])

  const loadAll = useCallback(
    async (rec: RecordingInfo) => {
      if (!rec.samples && !rec.error) {
        rec = await signalApi.detail(rec.id)
        setSelected(rec)
      }
      const block = 65536
      const offset = Math.floor((rec.samples ?? 0) * position)
      try {
        const [sp, st] = await Promise.all([
          signalApi.spectrum(rec.id, offset, block, 1024, 8),
          signalApi.stats(rec.id, offset, block),
        ])
        setSpectrum(sp)
        setStats(st)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [position],
  )

  useEffect(() => {
    void reloadList()
    signalApi.satdumpStatus().then(setSdStatus).catch(() => {})
  }, [reloadList])

  useEffect(() => {
    if (selected) void loadAll(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  // 回放推进
  useEffect(() => {
    if (!playing || !selected?.samples) return
    playTimer.current = window.setInterval(() => {
      setPosition((p) => {
        const step = 0.02
        const np = p + step
        if (np >= 1) {
          setPlaying(false)
          return 1
        }
        return np
      })
    }, 250)
    return () => {
      if (playTimer.current) window.clearInterval(playTimer.current)
    }
  }, [playing, selected?.samples])

  // 位置变化 → 刷新当前视图
  useEffect(() => {
    if (!selected?.id) return
    const offset = Math.floor((selected.samples ?? 0) * position)
    const jittered = Math.max(0, offset)
    if (tab === 'spectrum') {
      signalApi.spectrum(selected.id, jittered, 65536, 1024, 8).then(setSpectrum).catch(() => {})
      signalApi.stats(selected.id, jittered, 65536).then(setStats).catch(() => {})
    } else if (tab === 'waterfall') {
      signalApi.waterfall(selected.id, 128, 256, Math.max(0, position - 0.25), Math.min(1, position + 0.25)).then(setWaterfall).catch(() => {})
    } else if (tab === 'waveform') {
      signalApi.waveform(selected.id, jittered, 2000).then(setWaveform).catch(() => {})
    } else if (tab === 'constellation') {
      signalApi.constellation(selected.id, jittered, 2000).then(setConstellation).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, position, selected?.id])

  const refreshJobs = useCallback(async () => {
    if (!saveId) return
    const js = await signalApi.satdumpJobs(saveId)
    setJobs(js)
    return js
  }, [saveId])

  useEffect(() => {
    void refreshJobs()
  }, [refreshJobs])

  const onUpload = async (file: File) => {
    if (!saveId) return nav('/')
    setBusy(true)
    setErr(null)
    try {
      const rec = await uploadRecording(saveId, file, {
        format: fmt,
        sample_rate_hz: Number(srate) || 0,
        center_frequency_hz: Number(cfreq) || 0,
      })
      await reloadList()
      setSelected(rec)
      setPosition(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const refreshPipelines = async () => {
    setBusy(true)
    try {
      const r = await signalApi.satdumpPipelines()
      setPipelines(r.pipelines)
      if (r.pipelines.length && !pipeline) setPipeline(r.pipelines[0].name)
    } finally {
      setBusy(false)
    }
  }

  const startJob = async () => {
    if (!selected || !saveId || !pipeline) return
    setBusy(true)
    try {
      await signalApi.satdumpCreateJob({
        save_id: saveId,
        recording_id: selected.id,
        pipeline,
        samplerate: selected.sample_rate_hz || undefined,
        frequency: selected.center_frequency_hz || undefined,
        baseband_format: selected.format,
        sat_name: selected.satellite_id ? `SAT${selected.satellite_id}` : selected.filename,
      })
      await refreshJobs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const watchJob = async (jobId: string) => {
    setBusy(true)
    try {
      const r = await signalApi.satdumpLog(jobId)
      setLogText(r.log)
    } finally {
      setBusy(false)
    }
  }

  if (!saveId) {
    return (
      <div className="h-full panel flex items-center justify-center text-sm text-hud-dim">
        未进入存档
        <button className="btn ml-3" onClick={() => nav('/')}>
          返回主菜单
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader
        title="信号实验室"
        subtitle="频谱 · 瀑布图 · IQ 分析 · SatDump 离线解码"
        right={
          selected && (
            <span className="chip text-hud-amber border-hud-amber/40">
              {selected.source === 'RECORDED_IQ' ? 'RECORDED_IQ' : selected.source}
            </span>
          )
        }
      />

      {err && <div className="panel px-3 py-2 text-xs text-hud-red">{err}</div>}

      <div className="flex gap-3 flex-1 min-h-0">
        {/* 左：录波列表 + 导入 */}
        <div className="w-64 shrink-0 panel flex flex-col min-h-0">
          <div className="panel-header">
            <span>录波文件</span>
            <span className="font-mono normal-case">{recordings.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {recordings.length === 0 && <div className="p-3 text-xs text-hud-dim">导入一个 IQ 录波开始分析。</div>}
            {recordings.map((r) => (
              <button
                key={r.id}
                className={`w-full text-left px-2.5 py-1.5 border-b border-space-700/40 hover:bg-space-700/40 ${
                  selected?.id === r.id ? 'bg-hud-cyan/10 border-l-2 border-l-hud-cyan' : ''
                }`}
                onClick={() => {
                  setSelected(r)
                  setPosition(0)
                }}
              >
                <div className="text-[12px] text-slate-300 truncate">{r.filename}</div>
                <div className="text-[10px] font-mono text-hud-dim">
                  {r.format} · {(r.size_bytes / 1024).toFixed(0)} KB
                  {r.sample_rate_hz ? ` · ${(r.sample_rate_hz / 1000).toFixed(0)} kS/s` : ''}
                </div>
              </button>
            ))}
          </div>
          <div className="p-2.5 border-t border-space-600/50 space-y-1.5">
            <input
              type="file"
              className="input !h-7 text-[10px] file:mr-2 file:px-2 file:py-0.5 file:rounded file:border-0 file:bg-space-600 file:text-slate-200"
              onChange={(e) => e.target.files?.[0] && void onUpload(e.target.files[0])}
              disabled={busy}
              data-testid="recording-file-input"
            />
            <div className="grid grid-cols-3 gap-1">
              <select className="input !h-7 !text-[10px] px-1" value={fmt} onChange={(e) => setFmt(e.target.value)}>
                {FORMATS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input className="input !h-7 !text-[10px]" placeholder="采样率" value={srate} onChange={(e) => setSrate(e.target.value)} />
              <input className="input !h-7 !text-[10px]" placeholder="中心Hz" value={cfreq} onChange={(e) => setCfreq(e.target.value)} />
            </div>
          </div>
        </div>

        {/* 中：分析视图 */}
        <div className="flex-1 min-w-0 panel flex flex-col">
          <div className="panel-header">
            <div className="flex gap-1.5">
              {(
                [
                  ['spectrum', '频谱'],
                  ['waterfall', '瀑布图'],
                  ['waveform', 'IQ 波形'],
                  ['constellation', '星座图'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={`chip cursor-pointer ${tab === k ? 'text-hud-cyan border-hud-cyan/50' : 'hover:text-slate-300'}`}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="font-mono normal-case text-[10px]">
              {selected
                ? `偏移 ${(((selected.samples ?? 0) * position) | 0).toLocaleString()} 采样 (${(position * 100).toFixed(0)}%)`
                : '未选择录波'}
            </span>
          </div>

          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-hud-dim text-sm">
              <div className="text-center">
                <div className="text-4xl mb-2">📈</div>
                选择或导入录波文件
              </div>
            </div>
          ) : (
            <div className="flex-1 p-3 overflow-auto">
              {tab === 'spectrum' && spectrum && (
                <SpectrumPlot db={spectrum.db} freqSpanHz={spectrum.freq_span_hz} centerHz={selected.center_frequency_hz} />
              )}
              {tab === 'waterfall' && waterfall && (
                <WaterfallPlot
                  db={waterfall.db}
                  dbMin={waterfall.db_min}
                  dbMax={waterfall.db_max}
                  freqSpanHz={waterfall.freq_span_hz}
                  centerHz={selected.center_frequency_hz}
                />
              )}
              {tab === 'waveform' && waveform && <WaveformPlot i={waveform.i} q={waveform.q} />}
              {tab === 'constellation' && constellation && <ConstellationPlot points={constellation.points} />}

              {/* 回放控制 */}
              <div className="flex items-center gap-2 mt-3 px-1">
                <button
                  className="btn h-7 px-2"
                  onClick={() => setPlaying(!playing)}
                  disabled={!selected.samples}
                  data-testid="play-btn"
                >
                  {playing ? '❚❚' : '▶'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={position}
                  onChange={(e) => {
                    setPlaying(false)
                    setPosition(Number(e.target.value))
                  }}
                  className="flex-1 accent-cyan-400"
                  data-testid="playback-slider"
                />
                <span className="chip font-mono">{(position * 100).toFixed(0)}%</span>
              </div>
              {tab === 'spectrum' && Object.keys(stats).length > 0 && (
                <div className="grid grid-cols-6 gap-2 mt-3 text-[10px] font-mono text-hud-dim">
                  <Stat k="功率 dBFS" v={stats.power_dbfs?.toFixed(1)} />
                  <Stat k="峰值" v={stats.mag_peak?.toFixed(2)} />
                  <Stat k="DC I" v={stats.i_mean?.toFixed(3)} />
                  <Stat k="DC Q" v={stats.q_mean?.toFixed(3)} />
                  <Stat k="频偏" v={stats.freq_offset_hz ? `${(stats.freq_offset_hz / 1000).toFixed(2)} kHz` : '—'} />
                  <Stat k="裁剪率" v={`${((stats.clip_ratio ?? 0) * 100).toFixed(2)}%`} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右：SatDump */}
        <div className="w-80 shrink-0 panel overflow-y-auto">
          <div className="panel-header">
            <span>SatDump 解码</span>
            {sdStatus && (
              <span className={`font-mono normal-case ${sdStatus.installed ? 'text-hud-green' : 'text-hud-amber'}`}>
                {sdStatus.installed ? `v${sdStatus.version ?? '?'}` : '未安装'}
              </span>
            )}
          </div>
          <div className="p-3 space-y-3 text-xs">
            {sdStatus && !sdStatus.installed && (
              <div className="panel p-2.5 text-[11px] text-hud-dim leading-relaxed">
                {sdStatus.note}
                <div className="mt-1.5 font-mono text-[10px] text-slate-400">docs/satdump.md</div>
              </div>
            )}

            <div className="flex gap-2">
              <button className="btn h-7 text-[11px] flex-1" disabled={busy || !sdStatus?.installed} onClick={() => void refreshPipelines()}>
                ↻ 探测 Pipeline
              </button>
              <button className="btn btn-primary h-7 text-[11px] flex-1" disabled={busy || !selected || !pipeline} onClick={() => void startJob()} data-testid="start-decode">
                ▶ 启动解码
              </button>
            </div>

            {pipelines.length > 0 && (
              <select className="input !h-8 text-[11px]" value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
                {pipelines.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} — {p.desc.slice(0, 30)}
                  </option>
                ))}
              </select>
            )}

            <div>
              <div className="text-hud-dim uppercase tracking-widest text-[10px] mb-1">解码任务</div>
              <div className="space-y-1.5">
                {jobs.length === 0 && <div className="text-[11px] text-hud-dim">暂无任务</div>}
                {jobs.map((j) => (
                  <div key={j.id} className="panel p-2" data-testid={`job-${j.id.slice(0, 8)}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-[11px] text-slate-300">{j.pipeline}</span>
                      <span
                        className={`chip ${
                          j.status === 'done'
                            ? 'text-hud-green border-hud-green/40'
                            : j.status === 'failed'
                              ? 'text-hud-red border-hud-red/40'
                              : 'text-hud-blue border-hud-blue/40'
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                    {j.status === 'running' && (
                      <div className="h-1.5 mt-1.5 rounded bg-space-900 overflow-hidden">
                        <div className="h-full bg-hud-cyan" style={{ width: `${j.progress * 100}%` }} />
                      </div>
                    )}
                    {j.status === 'failed' && <div className="text-[10px] text-hud-red mt-1">{j.error}</div>}
                    {j.status === 'done' && (
                      <div className="text-[10px] text-hud-dim mt-1 font-mono">
                        {j.result_files?.length ?? 0} 个输出文件
                      </div>
                    )}
                    <div className="flex gap-1.5 mt-1.5">
                      <button className="btn h-6 text-[10px] px-2" onClick={() => void watchJob(j.id)}>
                        日志
                      </button>
                      {(j.status === 'running' || j.status === 'pending') && (
                        <button
                          className="btn btn-danger h-6 text-[10px] px-2"
                          onClick={async () => {
                            await signalApi.satdumpCancel(j.id)
                            await refreshJobs()
                          }}
                        >
                          取消
                        </button>
                      )}
                      {j.status === 'done' && (
                        <button
                          className="btn btn-primary h-6 text-[10px] px-2"
                          onClick={async () => {
                            await signalApi.satdumpCollect(j.id, {
                              save_id: saveId,
                              title: `${j.pipeline} 解码结果`,
                              satellite_id: selected?.satellite_id ?? null,
                            })
                            await refreshJobs()
                          }}
                        >
                          收藏
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {logText && (
              <div>
                <div className="text-hud-dim uppercase tracking-widest text-[10px] mb-1">任务日志</div>
                <pre className="bg-space-950 rounded p-2 text-[10px] font-mono text-slate-400 max-h-48 overflow-auto whitespace-pre-wrap">
                  {logText || '（空）'}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex flex-col">
      <span>{k}</span>
      <span className="text-slate-300">{v ?? '—'}</span>
    </div>
  )
}
