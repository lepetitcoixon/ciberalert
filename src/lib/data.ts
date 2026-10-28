// Tipos y utilidades de presentación compartidos por la UI.
// Los datos ya NO viven aquí: la UI los lee de la API (que a su vez lee de PostgreSQL).

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'

// Vocabulario real de la columna alerts.status (export del SharePoint)
export type AlertStatus = 'Nuevo' | 'En Proceso' | 'Escalado' | 'Solucionado' | 'Pentest'

export type AlertSource = 'email' | 'csv' | 'manual'
export type ActionName = 'Eliminado' | 'Escalado' | 'Falso positivo' | 'Registrado' | 'Reiniciado equipo' | 'Bloqueado'

export interface AlertAction {
  action: string
  actor: string
  source: string
  created_at: string
  detail?: string | null
}

export interface Alert {
  inc_id: string
  title: string
  source: AlertSource
  type: string
  severity: Severity
  status: AlertStatus
  result?: string | null
  action_edr?: string | null
  next_step?: string | null
  ai_summary?: string | null
  ai_recommendation?: string | null
  vt_url?: string | null
  hostname: string[]
  username: string[]
  ip: string[]
  group: string[]
  description: string
  file_path: string
  file_hash: string
  url: string
  detected_at: string
  created_at: string
  updated_at: string
  actions: AlertAction[]
}

export const severityClass: Record<string, string> = {
  Critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

export const statusClass: Record<string, string> = {
  Nuevo: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  'En Proceso': 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  Escalado: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Solucionado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Pentest: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
}

export const severityDot: Record<string, string> = {
  Critical: 'bg-red-400',
  High: 'bg-orange-400',
  Medium: 'bg-amber-400',
  Low: 'bg-slate-400',
}

export const statusDot: Record<string, string> = {
  Nuevo: 'bg-sky-400',
  'En Proceso': 'bg-violet-400',
  Escalado: 'bg-orange-400',
  Solucionado: 'bg-emerald-400',
  Pentest: 'bg-fuchsia-400',
}

export const severityWeight: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export const formatDate = (date: string) =>
  new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date))

const suggestedByType: Record<string, string> = {
  Malware: 'Aislar equipo, verificar hash en sandbox y confirmar eliminación con el usuario',
  Phishing: 'Bloquear URL, buscar mensajes similares y avisar al usuario',
  'XDR Incident': 'Revisar telemetría XDR, contener el endpoint y escalar si persiste',
  'Data Exfiltration': 'Contener origen, preservar evidencias y validar transferencia',
  'Anomalía de tráfico': 'Analizar flujo, validar destino y aplicar bloqueo temporal',
  'Política incumplida': 'Contactar al usuario y registrar excepción o remediación',
  Otro: 'Validar indicadores y documentar la resolución',
}

// El tipo real viene como texto libre del SOC, así que caemos a la recomendación genérica.
export const suggestedAction = (a: Pick<Alert, 'type' | 'severity'>) => {
  const base = suggestedByType[a.type] ?? suggestedByType.Otro
  return base + (a.severity === 'Critical' ? ' inmediatamente.' : '.')
}

export const nextStatus = (status: AlertStatus): AlertStatus =>
  status === 'Nuevo' ? 'En Proceso' : status === 'En Proceso' ? 'Escalado' : status === 'Escalado' ? 'Solucionado' : status
export const transitionStatus = nextStatus

export const navItems = [
  { href: '/', label: 'Dashboard', icon: 'grid' },
  { href: '/alerts', label: 'Alertas', icon: 'list' },
  { href: '/manage', label: 'Gestión', icon: 'settings' },
]

export const chartColors = { Critical: '#f87171', High: '#fb923c', Medium: '#fbbf24', Low: '#94a3b8', orange: '#fb923c', blue: '#38bdf8', violet: '#a78bfa' }
export const statusColors: Record<string, string> = { Nuevo: '#38bdf8', 'En Proceso': '#a78bfa', Escalado: '#fb923c', Solucionado: '#34d399', Pentest: '#e879f9' }

export const sourceLabels: Record<AlertSource, string> = { email: 'Email', csv: 'CSV', manual: 'Manual' }
export const actionNames: ActionName[] = ['Eliminado', 'Escalado', 'Falso positivo', 'Registrado', 'Reiniciado equipo', 'Bloqueado']

export const severityOptions: Severity[] = ['Critical', 'High', 'Medium', 'Low']
export const statusOptions: AlertStatus[] = ['Nuevo', 'En Proceso', 'Escalado', 'Solucionado', 'Pentest']

export const appName = 'CiberAlert'
export const appSubtitle = 'Gestión de alertas SOC'
export const dashboardTitle = 'Panel de operaciones'
export const dashboardDescription = 'Alertas abiertas priorizadas, acciones sugeridas y estado del sistema'
export const maxReviewCards = 10
export const staticWarning = 'Revisa el estado del lector de correo en Gestión'
export const defaultWarning = 'Sesión del lector de correo a punto de expirar'
export const analyst = { name: 'Lucía Martín', initials: 'LM', role: 'Analista SOC' }
export const ingestRules = ['.eml', '.csv']

// Rutas reales de la API (el segmento dinámico se llama [inc] y va por inc_id, no por id numérico)
export const apiRoutes = { list: '/api/alerts', detail: '/api/alerts/[inc]', update: '/api/alerts/[inc]', ingest: '/api/ingest' }

export type { Alert as AlertRecord }
