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
