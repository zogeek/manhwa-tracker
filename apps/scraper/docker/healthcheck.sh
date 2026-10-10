#!/usr/bin/env bash
# HEALTHCHECK du conteneur scraper : sain tant que scheduler.sh a touché son heartbeat récemment.
# Le heartbeat est rafraîchi avant chaque run et chaque attente : l'écart normal maximal est donc
# max(intervalle, durée max d'un run + 30 s de SIGKILL) ; au-delà (+ 5 min de marge), la boucle est bloquée.
set -euo pipefail

interval_s="${SCRAPER_SCHEDULE_INTERVAL_S:-7200}"
run_timeout_s="${SCRAPER_RUN_TIMEOUT_S:-3600}"
heartbeat_file="${SCRAPER_HEARTBEAT_FILE:-/tmp/manhwa-scraper.heartbeat}"

longest_s=$((interval_s > run_timeout_s + 30 ? interval_s : run_timeout_s + 30))
age_s=$(($(date +%s) - $(stat -c %Y "$heartbeat_file")))
if [[ $age_s -gt $((longest_s + 300)) ]]; then
  echo "heartbeat vieux de ${age_s}s (limite $((longest_s + 300))s)"
  exit 1
fi
