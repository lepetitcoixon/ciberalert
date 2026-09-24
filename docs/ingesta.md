# CiberAlert — modos de ingesta de alertas

Todas las vías convergen en la misma DB (dedupe por `inc_id` garantizado) y opcionalmente
en la API de ingesta (`POST /api/ingest`, token bearer igual al de `/etc/ciberalert-env`).

## 1. Watcher de carpeta (automático, sin permisos de IT)
- Servicio systemd `ciberalert-watcher` en el RHEL vigila `/var/spool/ciberalert/inbox/`.
- Cualquier `.eml` que aparezca se ingiere y mueve a `processed/` (a `failed/` si hay error).
- Alimentación del inbox sin permisos: SMB compartido en ese directorio, o script PowerShell
  en un PC con Outlook que guarde los correos de la carpeta de alertas como .eml (tarea programada).

## 2. API interna `POST /api/ingest`
- `Authorization: Bearer <INGEST_TOKEN>` (igual al de `/etc/ciberalert-env`).
- `multipart/form-data` con campo `files` (uno o varios .eml o .csv) o JSON eml a pelo.
- Devuelve por fichero: `{inc_id, created, action}`. Dedupe por INC automático.

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

## NO viables (descartados): 
- SMTP receptor (requiere relay corporativo), webhook del SOC (no lo ofrecen), IMAP (OAuth igual que Graph pero peor).

## Estado verificado (24 Sep 2026, CT102)
- ✅ CLI ingest-eml.js / import-csv.js probados con datos reales (1353 alertas).
- ✅ API POST /api/ingest con Bearer token: raw .eml (message/rfc822) y multipart files[]. Probada desde LAN.
- ✅ Watcher fs.watch en /var/spool/ciberalert/inbox (systemd ciberalert-watcher): INGEST verificado, 0 fallidos.
- ⚠️ chokidar v5 NO funciona en glibc EL8 (no dispara eventos) — no reintroducir; usa fs.watch nativo.
- ⚠️ next build con SWC no carga en EL8: ya fijado --webpack.
