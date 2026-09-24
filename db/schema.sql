-- CiberAlert — schema inicial (PostgreSQL 16)
CREATE TABLE IF NOT EXISTS alerts (
    id              SERIAL PRIMARY KEY,
    inc_id          TEXT UNIQUE,              -- INC0005669455 (natural key)
    source          TEXT NOT NULL DEFAULT 'email',  -- email | csv | manual
    title           TEXT,                     -- "XDR Incident 76283 - Local Analysis Malware"
    alert_type      TEXT,                     -- "Local Analysis Malware" (nombre limpio)
    alert_type_desc TEXT,                     -- descripción técnica (separada del nombre)
    severity        TEXT CHECK (severity IN ('High','Medium','Low','Info')),
    status          TEXT NOT NULL DEFAULT 'Nuevo',  -- Nuevo | En Proceso | Escalado | Solucionado
    result          TEXT,                     -- Controlado | Eliminado | Falso Positivo | Bloqueado | Excepcionado | Benigno | Pendiente
    detected_at     TIMESTAMPTZ,              -- fecha de detección (del EML o CSV)
    hostname        TEXT,
    endpoint_type   TEXT,                     -- AGENT_TYPE_WORKSTATION / SERVER
    os_name         TEXT,
    ip_addresses    TEXT[],
    domain          TEXT,
    username        TEXT,                     -- usuario afectado
    endpoint_group  TEXT,                     -- CAF_Beasain_General_Servers etc.
    action_edr      TEXT,                     -- DETECTED / BLOCKED...
    file_path       TEXT,
    file_hash       TEXT,                     -- SHA256 si viene
    vt_url          TEXT,                     -- enlace VirusTotal
    soc_url         TEXT,                     -- enlace portal SOC
    raw_summary     TEXT,                     -- resumen original (CSV)
    next_step       TEXT,                     -- siguiente paso original (CSV)
    email_message_id TEXT,                    -- Message-ID del EML origen
    ai_summary      TEXT,                     -- resumen generado por IA
    ai_recommendation TEXT,                   -- recomendación IA
    ai_similarity_hash TEXT,                  -- fingerprint para dedupe
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_detected ON alerts(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_hostname ON alerts(hostname);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);

-- Acciones/trazabilidad sobre cada alerta (incluye lo que llega en replies del EML)
CREATE TABLE IF NOT EXISTS alert_actions (
    id          SERIAL PRIMARY KEY,
    alert_id    INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    action      TEXT NOT NULL,               -- comentario | cambio_estado | cambio_resultado | respuesta_email
    actor       TEXT,                        -- email del usuario o 'system'
    detail      TEXT,
    source      TEXT DEFAULT 'web',          -- web | email | ai
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actions_alert ON alert_actions(alert_id);

-- Adjuntos/imágenes del EML (evidencia)
CREATE TABLE IF NOT EXISTS alert_attachments (
    id          SERIAL PRIMARY KEY,
    alert_id    INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    filename    TEXT,
    mime_type   TEXT,
    size_bytes  INTEGER,
    content     BYTEA
);

-- Usuarios (admins simples; auth propia, 2-3 usuarios)
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT,
    password_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alerts_touch ON alerts;
CREATE TRIGGER trg_alerts_touch BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
