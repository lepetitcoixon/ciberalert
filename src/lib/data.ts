export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type AlertStatus = 'Nuevo' | 'En revisión' | 'Escalado' | 'En espera' | 'Cerrado'
export type AlertType = 'Malware' | 'Phishing' | 'XDR Incident' | 'Data Exfiltration' | 'Anomalía de tráfico' | 'Política incumplida' | 'Otro'
export type AlertSource = 'email' | 'csv' | 'manual'
export type ActionName = 'Eliminado' | 'Escalado' | 'Falso positivo' | 'Registrado' | 'Reiniciado equipo' | 'Bloqueado'

export interface AlertAction { action: ActionName; actor: string; source: 'respuesta_email' | 'manual'; created_at: string; detail?: string }
export interface Alert { inc_id: string; title: string; source: AlertSource; type: AlertType; severity: Severity; status: AlertStatus; hostname: string[]; username: string[]; ip: string[]; group: string[]; description: string; file_path: string; file_hash: string; url: string; detected_at: string; created_at: string; updated_at: string; actions: AlertAction[] }

const actors = ['ana.garcia@ciberalert.io', 'marcos.ruiz@ciberalert.io', 'soc.analyst@ciberalert.io']
const types: AlertType[] = ['Malware', 'Phishing', 'XDR Incident', 'Data Exfiltration', 'Anomalía de tráfico', 'Política incumplida']
const severities: Severity[] = ['Critical', 'High', 'Medium', 'Low']
const statuses: AlertStatus[] = ['Nuevo', 'En revisión', 'Escalado', 'En espera', 'Cerrado']
const names = ['jlopez', 'mfernandez', 'cgarcia', 'lperez', 'arodriguez', 'smartin', 'dmoreno', 'nblanco']
const hosts = ['WKSTN-MAD-042', 'SRV-DB-PRD-02', 'LAPTOP-BCN-118', 'SRV-AD-01', 'WKSTN-VAL-077']
const dates = ['2026-09-24T08:15:00Z', '2026-09-23T16:42:00Z', '2026-09-22T11:30:00Z', '2026-09-21T09:05:00Z', '2026-09-19T14:22:00Z', '2026-09-18T18:10:00Z', '2026-09-17T07:44:00Z', '2026-09-15T12:20:00Z']

export const alerts: Alert[] = Array.from({ length: 24 }, (_, i) => {
  const type = types[i % types.length], severity = severities[i % 4], status = statuses[i % statuses.length]
  const date = dates[i % dates.length]
  const id = `INC000${5669455 + i}`
  return { inc_id: id, title: `${type === 'XDR Incident' ? 'XDR Incident' : type} ${76283 + i} - ${type === 'Malware' ? 'Local Analysis Malware' : 'Detección automática'}`, source: (i % 3 === 0 ? 'email' : i % 3 === 1 ? 'csv' : 'manual'), type, severity, status, hostname: [hosts[i % hosts.length], ...(i % 4 === 0 ? [hosts[(i + 1) % hosts.length]] : [])], username: [names[i % names.length]], ip: [`10.24.${i + 1}.${40 + i}`, ...(i % 5 === 0 ? [`10.24.${i + 1}.${80 + i}`] : [])], group: [i % 2 ? 'Corporate / Iberia' : 'Production / Core'], description: `El motor de detección ha identificado una actividad potencialmente maliciosa asociada a ${type.toLowerCase()}. Se requiere validación del analista para confirmar el alcance, revisar los indicadores y documentar la resolución.`, file_path: type === 'Phishing' ? '' : `C:\\Users\\${names[i % names.length]}\\AppData\\Local\\Temp\\payload_${i}.exe`, file_hash: `a${i}7f2c9d88b14e6a00c8e0b4c1f91d${'0'.repeat(39)}${i}`, url: `https://soc.ciberalert.io/incidents/${id}`, detected_at: date, created_at: date, updated_at: date, actions: i % 3 === 0 ? [{ action: 'Registrado', actor: actors[i % actors.length], source: 'respuesta_email', created_at: date, detail: 'Alerta ingerida desde el buzón SOC.' }] : [] }
})

export const severityClass: Record<Severity, string> = { Critical: 'bg-red-500/15 text-red-400 border-red-500/30', High: 'bg-orange-500/15 text-orange-400 border-orange-500/30', Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Low: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
export const statusClass: Record<AlertStatus, string> = { Nuevo: 'bg-sky-500/15 text-sky-400 border-sky-500/30', 'En revisión': 'bg-violet-500/15 text-violet-400 border-violet-500/30', Escalado: 'bg-orange-500/15 text-orange-400 border-orange-500/30', 'En espera': 'bg-slate-500/15 text-slate-300 border-slate-500/30', Cerrado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
export const suggestedAction = (a: any) => { const type: AlertType = a.type, severity: Severity = a.severity; return ({ Malware: 'Aislar equipo, verificar hash en sandbox y confirmar eliminación con el usuario', Phishing: 'Bloquear URL, buscar mensajes similares y avisar al usuario', 'XDR Incident': 'Revisar telemetría XDR, contener el endpoint y escalar si persiste', 'Data Exfiltration': 'Contener origen, preservar evidencias y validar transferencia', 'Anomalía de tráfico': 'Analizar flujo, validar destino y aplicar bloqueo temporal', 'Política incumplida': 'Contactar al usuario y registrar excepción o remediación', Otro: 'Validar indicadores y documentar la resolución' }[type] + (severity === 'Critical' ? ' inmediatamente.' : '.')) }
export const formatDate = (date: string) => new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
export const severityWeight: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }
export const openAlerts = alerts.filter(a => a.status !== 'Cerrado').sort((a,b) => severityWeight[b.severity]-severityWeight[a.severity] || +new Date(b.detected_at)-+new Date(a.detected_at))
export const monthly = [{ name: 'Abr', value: 31 }, { name: 'May', value: 45 }, { name: 'Jun', value: 38 }, { name: 'Jul', value: 52 }, { name: 'Ago', value: 47 }, { name: 'Sep', value: 64 }]
export const countsByStatus = statuses.map(name => ({ name, value: alerts.filter(a => a.status === name).length }))
export const countsBySeverity = severities.map(name => ({ name, value: alerts.filter(a => a.severity === name).length }))
export const countsByType = types.map(name => ({ name, value: alerts.filter(a => a.type === name).length })).sort((a,b) => b.value-a.value)
export const cloneAlerts = () => alerts.map(a => ({ ...a, hostname: [...a.hostname], username: [...a.username], ip: [...a.ip], group: [...a.group], actions: [...a.actions] }))
export const nextStatus = (status: AlertStatus): AlertStatus => status === 'Nuevo' ? 'En revisión' : status === 'En revisión' ? 'Escalado' : status === 'Escalado' ? 'Cerrado' : status

export type { Alert as AlertRecord }
export const sourceLabels: Record<AlertSource, string> = { email: 'Email', csv: 'CSV', manual: 'Manual' }
export const actionNames: ActionName[] = ['Eliminado', 'Escalado', 'Falso positivo', 'Registrado', 'Reiniciado equipo', 'Bloqueado']
export const statusOptions = statuses
export const severityOptions = severities
export const typeOptions = types
export const actorEmail = actors[0]
export const mockSummary = { total: alerts.length, open: alerts.filter(a => a.status !== 'Cerrado').length, critical: alerts.filter(a => a.severity === 'Critical').length, today: alerts.filter(a => a.detected_at.startsWith('2026-09-24')).length, escalated: alerts.filter(a => a.status === 'Escalado').length }
export const makeIngestedAlert = (): Alert => ({ ...alerts[0], inc_id: `INC${Date.now().toString().slice(-10)}`, title: 'Nueva alerta ingerida - revisión manual', source: 'manual', status: 'Nuevo', detected_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), actions: [] })
export const severityDot: Record<Severity,string> = { Critical: 'bg-red-400', High: 'bg-orange-400', Medium: 'bg-amber-400', Low: 'bg-slate-400' }
export const navItems = [{ href: '/', label: 'Dashboard', icon: 'grid' }, { href: '/alerts', label: 'Alertas', icon: 'list' }, { href: '/manage', label: 'Gestión', icon: 'settings' }]
export const chartColors = { Critical: '#f87171', High: '#fb923c', Medium: '#fbbf24', Low: '#94a3b8', orange: '#fb923c', blue: '#38bdf8', violet: '#a78bfa' }
export const statusColors = { Nuevo: '#38bdf8', 'En revisión': '#a78bfa', Escalado: '#fb923c', 'En espera': '#94a3b8', Cerrado: '#34d399' }
export const typeColors = ['#f87171', '#fb923c', '#fbbf24', '#38bdf8', '#a78bfa', '#34d399']
export const dataUpdated = 'Actualizado hace 2 min'
export const appVersion = 'v0.9.4'
export const appName = 'CiberAlert'
export const appSubtitle = 'Gestión de alertas SOC'
export const dashboardTitle = 'Panel de operaciones'
export const dashboardDescription = 'Alertas abiertas priorizadas, acciones sugeridas y estado del sistema'
export const dashboardKpis = [
  { label: 'Alertas abiertas', value: String(mockSummary.open), icon: 'shield' },
  { label: 'Críticas', value: String(mockSummary.critical), icon: 'alert' },
  { label: 'Nuevas hoy', value: String(mockSummary.today), icon: 'spark' },
  { label: 'Escaladas', value: String(mockSummary.escalated), icon: 'up' },
]
export const maxReviewCards = 10
export const priorityAlerts = openAlerts
export const severityCounts = countsBySeverity
export const statusCounts = countsByStatus
export const statusDot: Record<AlertStatus, string> = { Nuevo: 'bg-sky-400', 'En revisión': 'bg-violet-400', Escalado: 'bg-orange-400', 'En espera': 'bg-slate-400', Cerrado: 'bg-emerald-400' }
export const staticWarning = 'Revisa el estado del lector de correo en Gestión'
export const defaultWarning = 'Sesión del lector de correo a punto de expirar'
export const topTypes = countsByType.map(t => ({ type: t.name, count: t.value }))
export const transitionStatus = nextStatus
export const analyst = { name: 'Lucía Martín', initials: 'LM', role: 'Analista SOC' }
export const ingestRules = ['.eml', '.csv']
export const apiRoutes = { list: '/api/alerts', detail: '/api/alerts/:id', update: '/api/alerts/:id', ingest: '/api/ingest' }
export const emptyAlert: Alert | null = null
export const totalPages = Math.ceil(alerts.length / 20)
export const alertsPerPage = 20
export const mockWarning = '3 alertas recibidas sin procesar en las últimas 2 horas'
export const palette = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#64748b' }
