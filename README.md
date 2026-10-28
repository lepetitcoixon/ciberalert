# CiberAlert

Gestión de alertas de ciberseguridad corporativas.

## Stack
- Next.js 16 (App Router) + TypeScript + Tailwind v4
- PostgreSQL (self-hosted)

## Desarrollo
```bash
npm install
npm run dev
```

## Producción (RedHat 8)
```bash
npm install && npm run build && npm start   # puerto 3000
```
Requiere `DATABASE_URL` en variables de entorno.

## Análisis IA (M365 Copilot)

Las alertas se resumen y se les propone una recomendación usando
[M365-Copilot2API](https://github.com/HEXUXIU/M365-Copilot2API) como gateway compatible con OpenAI.

```bash
# .env.local
AI_BASE_URL=http://127.0.0.1:4141
AI_API_KEY=m365_...        # clave creada en la consola del gateway
AI_MODEL=gpt-5.5
AI_DELAY_MS=8000           # pausa entre llamadas (rate limit de Copilot)
```

- Al ingerir una alerta nueva se analiza en segundo plano (máximo 3 por petición; `AI_ON_INGEST=0` lo desactiva).
- `GET  /api/ai/enrich` — estado: modelo, gateway y alertas pendientes.
- `POST /api/ai/enrich` — lote: `{"limit":10,"statuses":["Nuevo","En Proceso","Escalado"],"force":false}`.
- `POST /api/alerts/{INC}/ai` — regenera el análisis de una alerta concreta.
- `node scripts/enrich-ai.js --limit=10` — mismo lote desde línea de comandos (`--status=`, `--force`, `--status-only`).

Si el gateway devuelve 429/5xx se reintenta con backoff y, tras tres fallos seguidos, el lote se corta
para no agravar el rate limit. Los rechazos del modelo por política de contenido no se guardan.
