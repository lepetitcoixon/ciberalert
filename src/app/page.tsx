'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, Check, ChevronRight, CircleDot, Copy, FileUp, LayoutDashboard, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import {
  appName, chartColors, dashboardDescription, dashboardTitle, defaultWarning, formatDate, maxReviewCards,
  navItems, severityClass, severityOptions, statusClass, statusDot, statusOptions, staticWarning, suggestedAction,
  transitionStatus, type Alert, type AlertStatus as Status, type Severity,
} from '@/lib/data'
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const Icon = ({ name }: { name: string }) => name === 'shield' ? <ShieldCheck /> : name === 'alert' ? <AlertTriangle /> : name === 'spark' ? <Sparkles /> : <ArrowUpRight />
const navIcon = (label: string) => label === 'Dashboard' ? <LayoutDashboard /> : label === 'Alertas' ? <CircleDot /> : <FileUp />

const monthAbbr = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export default function Page() {
  const [items, setItems] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Alert | null>(null)
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState<Severity | 'Todos'>('Todos')
  const [type, setType] = useState('Todos')
  const [toast, setToast] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/alerts?pageSize=500')
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.items)) setItems(d.items) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(
    () => items
      .filter(a => (!search || `${a.inc_id} ${a.title} ${a.description}`.toLowerCase().includes(search.toLowerCase()))
        && (severity === 'Todos' || a.severity === severity)
        && (type === 'Todos' || a.type === type))
      .filter(a => a.status !== 'Solucionado')
      .sort((a, b) => ({ Critical: 4, High: 3, Medium: 2, Low: 1 }[b.severity] - { Critical: 4, High: 3, Medium: 2, Low: 1 }[a.severity]) || b.detected_at.localeCompare(a.detected_at))
      .slice(0, maxReviewCards),
    [items, search, severity, type],
  )

  const stats = useMemo(() => {
    const typeCounts = new Map<string, number>()
    items.forEach(a => typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1))
    const topTypes = [...typeCounts.entries()].map(([t, c]) => ({ type: t, count: c })).sort((a, b) => b.count - a.count)
    const typeOptions = [...typeCounts.keys()].sort((a, b) => a.localeCompare(b))

    const statusCounts = statusOptions.map(s => ({ status: s, count: items.filter(a => a.status === s).length }))
    const severityCounts = severityOptions.map(s => ({ severity: s, count: items.filter(a => a.severity === s).length }))

    const byMonth = new Map<string, number>()
    items.forEach(a => { const d = new Date(a.detected_at); const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`; byMonth.set(k, (byMonth.get(k) || 0) + 1) })
    const monthly = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, c]) => ({ month: `${monthAbbr[Number(k.split('-')[1])]} ${k.split('-')[0].slice(2)}`, count: c }))

    const today = new Date().toISOString().slice(0, 10)
    const kpis = [
      { label: 'Alertas abiertas', value: String(items.filter(a => a.status !== 'Solucionado').length), icon: 'shield' },
      { label: 'Críticas', value: String(items.filter(a => a.severity === 'Critical').length), icon: 'alert' },
      { label: 'Nuevas hoy', value: String(items.filter(a => a.detected_at.slice(0, 10) === today).length), icon: 'spark' },
      { label: 'Escaladas', value: String(items.filter(a => a.status === 'Escalado').length), icon: 'up' },
    ]
    return { topTypes, typeOptions, statusCounts, severityCounts, monthly, kpis }
  }, [items])

  const maxTypeCount = stats.topTypes[0]?.count || 1

  const update = (id: string, next: Status | 'Falso positivo') => {
    const isFP = next === 'Falso positivo'
    setItems(old => old.map(a => a.inc_id === id ? { ...a, status: isFP ? 'Solucionado' : next } : a))
    setToast(isFP ? 'Alerta marcada como falso positivo' : `Estado actualizado: ${next}`)
    setTimeout(() => setToast(''), 3000)
    fetch(`/api/alerts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isFP ? { new_action: 'Falso positivo' } : { status: next }),
    }).then(r => r.json()).then(d => {
      if (d && d.inc_id) setItems(old => old.map(a => a.inc_id === d.inc_id ? { ...a, ...d, actions: a.actions } : a))
    }).catch(() => {})
  }

  return <div className="min-h-screen bg-[#07111f] text-slate-100">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/10 bg-[#0a1626] lg:flex lg:flex-col">
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6"><div className="flex size-9 items-center justify-center rounded-lg bg-sky-500 font-bold text-slate-950">CA</div><div><div className="font-semibold tracking-tight">{appName}</div><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">SOC interno</div></div></div>
      <nav className="flex flex-1 flex-col gap-1 p-4"><div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operaciones</div>{navItems.map(item => <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${item.href === '/' ? 'bg-sky-500/10 text-sky-300' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>{navIcon(item.label)}<span>{item.label}</span>{item.label === 'Alertas' && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">{items.length}</span>}</Link>)}</nav>
      <div className="m-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="size-2 rounded-full bg-emerald-400" />Sistema operativo</div><div className="text-[11px] leading-relaxed text-slate-500">Última sincronización<br /><span className="text-slate-300">{new Date().toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div></div>
    </aside>
    <main className="lg:pl-64"><header className="flex h-20 items-center justify-between border-b border-white/10 px-5 sm:px-8"><div className="flex items-center gap-3"><button className="lg:hidden"><Menu /></button><div><p className="text-xs text-slate-500">SOC / Operaciones</p><h1 className="text-lg font-semibold">Buenos días, Ana</h1></div></div><div className="flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:block">{new Date().toLocaleString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><div className="flex size-8 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">AM</div></div></header>
      <div className="mx-auto max-w-[1500px] p-5 sm:p-8"><div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-sky-400"><span className="size-1.5 rounded-full bg-sky-400" />Monitorización activa</div><h2 className="text-2xl font-semibold tracking-tight">{dashboardTitle}</h2><p className="mt-1 text-sm text-slate-500">{dashboardDescription}</p></div><Link href="/alerts" className="flex items-center gap-2 self-start rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10">Ver todas las alertas <ArrowUpRight /></Link></div>
        <div className="mb-8 grid grid-cols-2 gap-3 xl:grid-cols-4">{stats.kpis.map((kpi, i) => <div key={kpi.label} className="rounded-xl border border-white/10 bg-[#0d1b2e] p-4"><div className="mb-4 flex items-center justify-between"><span className="text-xs text-slate-500">{kpi.label}</span><span className={`flex size-8 items-center justify-center rounded-lg ${i === 1 ? 'bg-red-500/10 text-red-400' : i === 2 ? 'bg-sky-500/10 text-sky-400' : 'bg-violet-500/10 text-violet-400'}`}><Icon name={kpi.icon} /></span></div><div className="text-2xl font-semibold tracking-tight">{kpi.value}</div><div className="mt-1 text-[11px] text-slate-500">sobre {items.length} alertas sincronizadas</div></div>)}</div>
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 sm:flex-row sm:items-center"><AlertTriangle className="text-amber-400" /><div className="flex-1"><div className="text-xs font-medium text-amber-200">Atención operativa</div><div className="text-xs text-amber-200/60">{defaultWarning} · {staticWarning}</div></div><Link href="/manage" className="text-xs text-amber-300 hover:underline">Revisar configuración</Link></div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,1fr)]"><section><div className="mb-3 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por INC, título o descripción…" className="h-10 w-full rounded-lg border border-white/10 bg-[#0d1b2e] pl-10 pr-3 text-sm outline-none placeholder:text-slate-600 focus:border-sky-500/50" /></div><select value={severity} onChange={e => setSeverity(e.target.value as Severity | 'Todos')} className="h-10 rounded-lg border border-white/10 bg-[#0d1b2e] px-3 text-xs text-slate-300 outline-none"><option>Todos</option>{severityOptions.map(s => <option key={s}>{s}</option>)}</select><select value={type} onChange={e => setType(e.target.value)} className="h-10 rounded-lg border border-white/10 bg-[#0d1b2e] px-3 text-xs text-slate-300 outline-none"><option>Todos</option>{stats.typeOptions.map(t => <option key={t}>{t}</option>)}</select></div>
          <div className="flex flex-col gap-3">{loading && <div className="rounded-xl border border-white/10 bg-[#0d1b2e] p-4 text-sm text-slate-500">Cargando alertas desde la base de datos…</div>}{!loading && filtered.length === 0 && <div className="rounded-xl border border-white/10 bg-[#0d1b2e] p-4 text-sm text-slate-500">No hay alertas abiertas que coincidan con el filtro.</div>}{filtered.map(alert => <AlertCard key={alert.inc_id} alert={alert} onSelect={() => setSelected(alert)} onUpdate={next => update(alert.inc_id, next)} />)}</div></section>
          <section className="space-y-4"><StatsPanel title="Distribución por estado"><ResponsiveContainer width="100%" height={150}><PieChart><Pie data={stats.statusCounts} dataKey="count" nameKey="status" innerRadius={45} outerRadius={65} paddingAngle={3} stroke="none" fill={chartColors.violet} /><Tooltip contentStyle={{ background: '#0d1b2e', border: '1px solid #ffffff1a', borderRadius: 8, fontSize: 11 }} /></PieChart></ResponsiveContainer><div className="grid grid-cols-2 gap-2">{stats.statusCounts.map(s => <div key={s.status} className="flex items-center gap-2 text-[11px] text-slate-400"><span className={`size-2 rounded-full ${statusDot[s.status]}`} />{s.status}<span className="ml-auto text-slate-200">{s.count}</span></div>)}</div></StatsPanel>
            <StatsPanel title="Alertas por severidad"><ResponsiveContainer width="100%" height={150}><BarChart data={stats.severityCounts} layout="vertical"><CartesianGrid horizontal={false} stroke="#ffffff10" /><XAxis type="number" hide /><YAxis type="category" dataKey="severity" width={58} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} /><Bar dataKey="count" fill={chartColors.orange} radius={[0, 4, 4, 0]} barSize={14} /><Tooltip contentStyle={{ background: '#0d1b2e', border: '1px solid #ffffff1a', borderRadius: 8, fontSize: 11 }} /></BarChart></ResponsiveContainer></StatsPanel>
            <StatsPanel title="Evolución mensual"><ResponsiveContainer width="100%" height={150}><LineChart data={stats.monthly}><CartesianGrid vertical={false} stroke="#ffffff10" /><XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis hide /><Line type="monotone" dataKey="count" stroke={chartColors.blue} strokeWidth={2} dot={{ r: 3, fill: chartColors.blue }} /><Tooltip contentStyle={{ background: '#0d1b2e', border: '1px solid #ffffff1a', borderRadius: 8, fontSize: 11 }} /></LineChart></ResponsiveContainer></StatsPanel>
            <StatsPanel title="Top tipos"><div className="flex flex-col gap-3">{stats.topTypes.slice(0, 5).map(t => <div key={t.type}><div className="mb-1 flex justify-between text-[11px]"><span className="truncate pr-2 text-slate-400">{t.type}</span><span className="text-slate-200">{t.count}</span></div><div className="h-1 rounded-full bg-white/10"><div className="h-1 rounded-full bg-sky-400" style={{ width: `${Math.max(6, Math.round(t.count / maxTypeCount * 100))}%` }} /></div></div>)}</div></StatsPanel>
          </section></div>
      </div>
    </main>
    {selected && <DetailPanel alert={selected} onClose={() => setSelected(null)} onUpdate={next => { update(selected.inc_id, next); setSelected(null) }} />}{toast && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-[#11251f] px-4 py-3 text-sm text-emerald-300 shadow-xl"><Check /> {toast}</div>}
  </div>
}

function AlertCard({ alert, onSelect, onUpdate }: { alert: Alert; onSelect: () => void; onUpdate: (next: Status | 'Falso positivo') => void }) { return <article className="group rounded-xl border border-white/10 bg-[#0d1b2e] p-4 transition hover:border-sky-500/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><button onClick={onSelect} className="font-mono text-xs font-semibold text-sky-400 hover:underline">{alert.inc_id}</button><span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${severityClass[alert.severity] || severityClass.Low}`}>{alert.severity}</span><span className={`rounded border px-2 py-0.5 text-[10px] ${statusClass[alert.status] || ''}`}>{alert.status}</span></div><button onClick={onSelect} className="block w-full truncate text-left text-sm font-medium text-slate-100 hover:text-sky-300">{alert.description || alert.title}</button><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500"><span className="truncate">{alert.type}</span><span>{alert.hostname.join(', ')}</span><span>Acción EDR: <span className="text-slate-300">{alert.action_edr || '—'}</span></span><span>Detectada {formatDate(alert.detected_at)}</span></div></div><button onClick={onSelect} aria-label="Ver detalle" className="rounded p-1 text-slate-600 hover:bg-white/5 hover:text-slate-200"><ChevronRight /></button></div><div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center"><div className="flex-1 text-xs leading-relaxed text-slate-400"><span className="font-medium text-sky-300">Siguiente paso: </span>{alert.next_step || suggestedAction(alert)}</div><div className="flex shrink-0 gap-2"><button onClick={() => onUpdate(transitionStatus(alert.status))} className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-300 hover:bg-sky-500/20">Avanzar</button><button onClick={() => onUpdate('Falso positivo')} className="rounded-md border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-white/5">Falso positivo</button></div></div></article> }
function StatsPanel({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-xl border border-white/10 bg-[#0d1b2e] p-4"><div className="mb-3 text-xs font-medium text-slate-300">{title}</div>{children}</div> }
function DetailPanel({ alert, onClose, onUpdate }: { alert: Alert; onClose: () => void; onUpdate: (next: Status) => void }) { const [copied, setCopied] = useState(false); return <><button aria-label="Cerrar detalle" onClick={onClose} className="fixed inset-0 z-20 bg-black/50" /><aside className="fixed inset-y-0 right-0 z-30 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0a1626] p-6 shadow-2xl"><div className="mb-6 flex items-start justify-between"><div><div className="mb-2 font-mono text-xs text-sky-400">{alert.inc_id}</div><h2 className="max-w-md text-lg font-semibold">{alert.title}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/5"><X /></button></div><div className="mb-6 flex gap-2"><span className={`rounded border px-2 py-1 text-xs ${severityClass[alert.severity] || severityClass.Low}`}>{alert.severity}</span><span className={`rounded border px-2 py-1 text-xs ${statusClass[alert.status] || ''}`}>{alert.status}</span></div><div className="mb-6 rounded-lg border border-white/10 bg-white/[0.02] p-4"><div className="mb-2 text-xs font-medium text-slate-400">Descripción</div><p className="text-sm leading-relaxed text-slate-300">{alert.description || '—'}</p></div>{alert.next_step && <div className="mb-6 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4"><div className="mb-2 text-xs font-medium text-sky-300">Siguiente paso</div><p className="text-sm leading-relaxed text-slate-300">{alert.next_step}</p></div>}<div className="grid grid-cols-2 gap-4 text-xs"><DetailField label="Tipo" value={alert.type} /><DetailField label="Origen" value={alert.source} /><DetailField label="Resultado" value={alert.result || '—'} /><DetailField label="Acción EDR" value={alert.action_edr || '—'} /><DetailField label="Equipos" value={alert.hostname.join(', ') || '—'} /><DetailField label="Usuarios" value={alert.username.join(', ') || '—'} /><DetailField label="IPs" value={alert.ip.join(', ') || '—'} /><DetailField label="Grupos" value={alert.group.join(', ') || '—'} /><DetailField label="Detectada" value={formatDate(alert.detected_at)} /><DetailField label="Actualizada" value={formatDate(alert.updated_at)} /></div><div className="my-6 border-t border-white/10 pt-5"><div className="mb-3 text-xs font-medium text-slate-400">Evidencia de archivo</div><div className="mb-2 break-all rounded-lg border border-white/10 bg-[#07111f] p-3 font-mono text-[11px] text-slate-400">{alert.file_path || 'No informado'}</div><div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#07111f] p-3 font-mono text-[10px] text-slate-500"><span className="break-all">SHA256: {alert.file_hash || '—'}</span><button onClick={() => { navigator.clipboard?.writeText(alert.file_hash); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="ml-auto shrink-0 rounded bg-white/5 p-1 text-slate-300 hover:bg-white/10">{copied ? <Check /> : <Copy />}</button></div>{alert.url && <a href={alert.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-sky-400 hover:underline">Abrir en portal SOC <ArrowUpRight /></a>}{alert.vt_url && <a href={alert.vt_url} target="_blank" rel="noreferrer" className="ml-3 mt-3 inline-flex items-center gap-1 text-xs text-rose-400 hover:underline">VirusTotal <ArrowUpRight /></a>}</div><div className="mb-6"><div className="mb-3 text-xs font-medium text-slate-400">Timeline de acciones</div><div className="flex flex-col gap-3 border-l border-white/10 pl-4">{alert.actions.length === 0 && <div className="text-[11px] text-slate-500">Sin acciones registradas.</div>}{alert.actions.map((a, i) => <div key={i} className="relative"><span className="absolute -left-[21px] top-1 size-2 rounded-full bg-sky-400" /><div className="text-xs text-slate-200">{a.action}</div><div className="text-[11px] text-slate-500">{a.actor} · {formatDate(a.created_at)}</div></div>)}</div></div><div className="flex gap-2"><button onClick={() => onUpdate(transitionStatus(alert.status))} className="flex-1 rounded-lg bg-sky-500 px-3 py-2 text-xs font-medium text-slate-950 hover:bg-sky-400">Avanzar estado</button><button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5">Cerrar</button></div></aside></> }
function DetailField({ label, value }: { label: string; value: string }) { return <div><div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">{label}</div><div className="text-slate-300">{value}</div></div> }
