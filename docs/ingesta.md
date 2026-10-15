# CiberAlert — modos de ingesta de alertas

Todas las vías convergen en la misma DB (dedupe por `inc_id` garantizado) y opcionalmente
en la API de ingesta (`POST /api/ingest`, token bearer igual al de `/etc/ciberalert-env`).

## 1. Watcher de carpeta (automático, sin permisos de IT)
- Servicio systemd `ciberalert-watcher` en el RHEL vigila `/var/spool/ciberalert/inbox/`.
- Cualquier `.eml` que aparezca se ingiere y mueve a `processed/` (a `failed/` si hay error).
- Alimentación del inbox sin permisos: SMB compartido en ese directorio, o script PowerShell
  en un PC con Outlook que guarde los correos de la carpeta de alertas como .eml (tarea programada).

## 2. API interna `POST /api/ingest`
- `Authorization: Bearer <INGEST_TOKEN>` (si `INGEST_TOKEN` está vacío, la puerta queda abierta; pensada para localhost/LAN).
- `multipart/form-data` con campo `files` (uno o varios .eml o .csv), `message/rfc822` (.eml crudo) o `application/json` (campos sueltos, ver §7).
- Devuelve por fichero/alerta: `{inc_id, created, action}`. Dedupe por INC automático.

## 3. CLI directo en el servidor
```bash
scripts/run-with-env.sh node scripts/ingest-eml.js /ruta/alerta.eml   # un eml
scripts/run-with-env.sh node scripts/import-csv.js  /ruta/registro.csv
```

## 4. CSV del SharePoint
- web: botón "Importar CSV" (upsert por INC).
- CLI: `import-csv.js`. Sirve para histórico y para syncs periódicos mientras exista el export.

## 5. Microsoft Graph (modo pro, requiere IT — pendiente de decidir por Mike)
- App registrada en Entra + Application permission `Mail.Read` sobre el buzón compartido de alertas.
- Daemon poller cada 2-5 min: solo HTTPS saliente, nada expuesto a internet.
- Captura alertas nuevas **y replies de analistas** (acciones: Eliminado/Escalado...).

## 6. Subida manual
- Arrastrar .eml al web UI. Backfill puntual y alertas sueltas.

## 7. Power Automate Desktop (JSON)
Para enviar campos sueltos desde un flujo de Power Automate Desktop (corre en el mismo PC que la app).

- Acción **"Llamar al servicio web"** (`Invoke web service`):
  - URL: `http://localhost:3000/api/ingest`
  - Método: `POST`
  - Cabeceras: `Content-Type: application/json`, `Accept: application/json`
  - Cuerpo:
```json
{
  "inc_id": "INC0005675021",
  "title": "XDR Incident 76283 - Local Analysis Malware",
  "alert_type": "Local Analysis Malware",
  "alert_type_desc": "Detección de malware en endpoint",
  "severity": "High",
  "status": "Nuevo",
  "result": "Pendiente",
  "detected_at": "2026-09-23T12:00:00Z",
  "hostname": "PC26806",
  "username": "NT AUTHORITY\\SYSTEM",
  "ip_addresses": ["10.24.1.40"],
  "endpoint_group": "CAF_Beasain_General_Workstations",
  "action_edr": "DETECTED",
  "soc_url": "https://cybersecurity.telefonica.com/..."
}
```
- Se acepta un objeto suelto, un array o `{"alerts": [...]}`. Respuesta: `{ok:true, results:[{inc_id, alert_id, created}]}`.
- Alias admitidos (español/inglés): `incidencia/inc/id`, `titulo`, `tipo`, `descripcion/description`, `severidad`, `estado`,
  `resultado`, `fecha/detected_at`, `equipo`, `usuario`, `ips/ip`, `grupo`, `resumen`, `siguiente_paso`, `hash/sha256`, `virustotal`, `enlace_soc`.
- `severity` se normaliza a `Critical|High|Medium|Low|Info`; `status` a `Nuevo|En Proceso|Escalado|Solucionado|Pentest`.
- Upsert por `inc_id`: si ya existe, **actualiza** (no duplica) y conserva lo que no venga en el payload.
- Escenarios **cloud → desktop**: un flujo de nube (conector Office 365 Outlook) no puede llegar a `localhost`, así que llama a un flujo de escritorio pasándole el JSON ya montado; el de escritorio lo reenvía tal cual en el cuerpo del POST.
- Si el texto trae comillas/saltos de línea, manda esos campos en **Base64** para no escapar nada: `title_b64`, `raw_summary_b64`, `username_b64`, `inc_id_b64`, … (se decodifican a UTF-8 sobre el campo equivalente).
- Requiere que la app esté accesible en `localhost` (bind solo-localhost). Sin token mientras `INGEST_TOKEN` esté vacío.

## NO viables (descartados): 
- SMTP receptor (requiere relay corporativo), webhook del SOC (no lo ofrecen), IMAP (OAuth igual que Graph pero peor).

## Estado verificado (24 Sep 2026, CT102)
- ✅ CLI ingest-eml.js / import-csv.js probados con datos reales (1353 alertas).
- ✅ API POST /api/ingest con Bearer token: raw .eml (message/rfc822) y multipart files[]. Probada desde LAN.
- ✅ Watcher fs.watch en /var/spool/ciberalert/inbox (systemd ciberalert-watcher): INGEST verificado, 0 fallidos.
- ⚠️ chokidar v5 NO funciona en glibc EL8 (no dispara eventos) — no reintroducir; usa fs.watch nativo.
- ⚠️ next build con SWC no carga en EL8: ya fijado --webpack.
