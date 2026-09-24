#!/bin/bash
# Wrapper: carga /etc/ciberalert-env EXPORTANDO las variables y ejecuta el comando dado
# Uso: run-with-env.sh node scripts/import-csv.js /tmp/registro.csv
set -a
source /etc/ciberalert-env
set +a
exec "$@"
