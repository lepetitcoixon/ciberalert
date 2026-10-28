'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search } from 'lucide-react'
import { formatDate, severityClass, statusClass, type Alert } from '@/lib/data'

const columns = ['INC', 'Título', 'Tipo', 'Severidad', 'Estado', 'Resultado', 'Acción EDR', 'Equipo', 'Detección']

export default function AlertsPage() {
  const [items, setItems] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Alert | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/alerts?pageSize=500')
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.items)) setItems(d.items) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  const shown = useMemo(() => items.filter(a => `${a.inc_id} ${a.title} ${a.type} ${a.result ?? ''} ${a.action_edr ?? ''} ${a.description}`.toLowerCase().includes(q.toLowerCase())), [items, q])
  return <main className="min-h-screen bg-[#07111f] p-5 text-slate-100 sm:p-8"><div className="mx-auto max-w-[1500px]"><Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-sky-300"><ArrowLeft /> Dashboard</Link><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs uppercase tracking-[0.16em] text-sky-400">Inventario operativo</p><h1 className="text-2xl font-semibold">Todas las alertas</h1><p className="mt-1 text-sm text-slate-500">{loading ? 'Cargando…' : `${shown.length} de ${items.length} alertas`}</p></div><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por INC, título, tipo, resultado…" className="h-10 w-full rounded-lg border border-white/10 bg-[#0d1b2e] pl-10 pr-3 text-sm outline-none sm:w-80" /></div></div><div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0d1b2e]"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500"><tr>{columns.map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{shown.map(a => <tr key={a.inc_id} onClick={() => setSelected(a)} className="cursor-pointer text-slate-300 hover:bg-white/[0.03]"><td className="px-4 py-3 font-mono text-xs text-sky-400">{a.inc_id}</td><td className="max-w-[260px] truncate px-4 py-3">{a.title}</td><td className="px-4 py-3 text-xs text-slate-400">{a.type}</td><td className="px-4 py-3"><span className={`rounded border px-2 py-1 text-[10px] ${severityClass[a.severity] || severityClass.Low}`}>{a.severity}</span></td><td className="px-4 py-3"><span className={`rounded border px-2 py-1 text-[10px] ${statusClass[a.status] || ''}`}>{a.status}</span></td><td className="px-4 py-3 text-xs">{a.result || '—'}</td><td className="px-4 py-3 text-xs font-mono">{a.action_edr || '—'}</td><td className="px-4 py-3 text-xs">{a.hostname.join(', ') || '—'}</td><td className="px-4 py-3 text-xs text-slate-500">{formatDate(a.detected_at)}</td></tr>)}</tbody></table></div></div>{selected && <aside className="fixed inset-y-0 right-0 w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0a1626] p-6 shadow-2xl"><button onClick={() => setSelected(null)} className="mb-6 text-sm text-slate-400 hover:text-white">Cerrar detalle</button><div className="font-mono text-xs text-sky-400">{selected.inc_id}</div><h2 className="mt-2 text-xl font-semibold">{selected.title}</h2><div className="mt-3 flex gap-2"><span className={`rounded border px-2 py-1 text-xs ${severityClass[selected.severity] || severityClass.Low}`}>{selected.severity}</span><span className={`rounded border px-2 py-1 text-xs ${statusClass[selected.status] || ''}`}>{selected.status}</span></div><p className="mt-5 text-sm leading-relaxed text-slate-300">{selected.description || '—'}</p>{selected.next_step && <div className="mt-5 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4"><div className="mb-2 text-xs font-medium text-sky-300">Siguiente paso</div><p className="text-sm leading-relaxed text-slate-300">{selected.next_step}</p></div>}<div className="mt-6 grid grid-cols-2 gap-5 text-xs"><Field label="Tipo" value={selected.type} /><Field label="Origen" value={selected.source} /><Field label="Resultado" value={selected.result || '—'} /><Field label="Acción EDR" value={selected.action_edr || '—'} /><Field label="Equipos" value={selected.hostname.join(', ') || '—'} /><Field label="Usuarios" value={selected.username.join(', ') || '—'} /><Field label="IPs" value={selected.ip.join(', ') || '—'} /><Field label="Grupo" value={selected.group.join(', ') || '—'} /><Field label="Detectada" value={formatDate(selected.detected_at)} /><Field label="Actualizada" value={formatDate(selected.updated_at)} /></div><div className="mt-6 border-t border-white/10 pt-5 text-xs"><div className="text-slate-500">SHA256</div><p className="mt-2 break-all font-mono text-slate-400">{selected.file_hash || '—'}</p>{selected.url && <a className="mt-4 inline-block text-sky-400" href={selected.url} target="_blank" rel="noreferrer">Abrir en portal SOC →</a>}{selected.vt_url && <a className="mt-4 ml-4 inline-block text-rose-400" href={selected.vt_url} target="_blank" rel="noreferrer">VirusTotal →</a>}</div><AiPanel alert={selected} onUpdated={a => { setSelected(a); setItems(prev => prev.map(x => (x.inc_id === a.inc_id ? a : x))) }} /></aside>}</main>
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><span className="text-slate-600">{label}</span><p className="mt-1 text-slate-300">{value}</p></div>
}

function AiPanel({ alert, onUpdated }: { alert: Alert; onUpdated: (a: Alert) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/alerts/${encodeURIComponent(alert.inc_id)}/ai`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
      onUpdated(d as Alert)
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el análisis')
    } finally {
      setBusy(false)
    }
  }
  return <div className="mt-5 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="text-xs font-medium text-violet-300">Análisis IA</div>
      <button onClick={run} disabled={busy} className="rounded border border-violet-400/30 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/10 disabled:opacity-50">{busy ? 'Analizando…' : alert.ai_summary ? 'Regenerar' : 'Generar'}</button>
    </div>
    {alert.ai_summary ? <><p className="text-sm leading-relaxed text-slate-300">{alert.ai_summary}</p>{alert.ai_recommendation && <div className="mt-3"><div className="mb-1 text-[10px] uppercase tracking-wider text-violet-300/70">Recomendación</div><p className="text-sm leading-relaxed text-slate-300">{alert.ai_recommendation}</p></div>}</> : <p className="text-xs text-slate-500">Sin análisis todavía.</p>}
    {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
  </div>
}
