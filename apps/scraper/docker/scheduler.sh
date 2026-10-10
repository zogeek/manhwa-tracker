#!/usr/bin/env bash
# Planificateur du conteneur scraper : lance `manhwa-scraper track --from-api` pour chaque source, à intervalle fixe.
#
# Pourquoi une boucle et pas cron : cron ne transmet pas l'environnement du conteneur (SCRAPER_API_KEY…) aux tâches,
# écrit ailleurs que sur stdout (invisible dans `docker logs`), et peut lancer un run alors que le précédent tourne
# encore. Ici un seul processus, des runs jamais superposés, des logs dans `docker logs`, et un arrêt propre.
#
# Variables :
#   SCRAPER_TRACK_TARGETS        sources à suivre, `slug=uuid` séparés par des virgules (vide : le worker attend)
#   SCRAPER_SCHEDULE_INTERVAL_S  cadence entre deux débuts de cycle, en secondes (défaut 7200 = 2 h)
#   SCRAPER_RUN_TIMEOUT_S        durée max d'un run ; au-delà il est interrompu (défaut 3600)
#   SCRAPER_HEARTBEAT_FILE       fichier « battement de cœur » lu par healthcheck.sh
set -uo pipefail # pas de -e : un run en échec ne doit jamais arrêter la boucle

interval_s="${SCRAPER_SCHEDULE_INTERVAL_S:-7200}"
run_timeout_s="${SCRAPER_RUN_TIMEOUT_S:-3600}"
heartbeat_file="${SCRAPER_HEARTBEAT_FILE:-/tmp/manhwa-scraper.heartbeat}"
targets_raw="${SCRAPER_TRACK_TARGETS:-}"

log() { printf '%s [scheduler] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR : $*"; exit 2; }

# ── Validation au démarrage : une config invalide arrête le conteneur tout de suite, pas au premier run ──────────
[[ "$interval_s" =~ ^[0-9]+$ && "$interval_s" -ge 60 ]] || die "SCRAPER_SCHEDULE_INTERVAL_S doit être un entier >= 60"
[[ "$run_timeout_s" =~ ^[0-9]+$ && "$run_timeout_s" -ge 60 ]] || die "SCRAPER_RUN_TIMEOUT_S doit être un entier >= 60"
uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
targets=()
IFS=',' read -ra entries <<<"$targets_raw"
for entry in "${entries[@]}"; do
  entry="${entry//[[:space:]]/}"
  [[ -z "$entry" ]] && continue
  slug="${entry%%=*}"
  source_id="${entry#*=}"
  [[ "$entry" == *=* && "$slug" =~ ^[a-z0-9-]+$ && "$source_id" =~ $uuid_re ]] ||
    die "cible invalide « $entry » dans SCRAPER_TRACK_TARGETS (format attendu : slug=uuid,slug=uuid)"
  targets+=("$slug=$source_id")
done
if [[ ${#targets[@]} -eq 0 ]]; then
  # Premier déploiement : les UUID des sources n'existent qu'une fois l'API démarrée. Plutôt que de redémarrer en
  # boucle, le worker attend (et healthcheck.sh le signale `unhealthy` faute de heartbeat récent).
  log "⚠ SCRAPER_TRACK_TARGETS est vide : aucun run planifié. Renseigner slug=uuid (UUID : GET /sources de l'API)"
  log "  puis recréer le conteneur : docker compose up -d scraper"
  trap 'exit 0' TERM INT
  sleep infinity &
  wait
  exit 0
fi

# ── Arrêt propre ─────────────────────────────────────────────────────────────────────────────────────────────────
# `docker stop` envoie SIGTERM. Bash ne traite un signal qu'entre deux commandes : on lance donc chaque run et
# chaque attente en arrière-plan puis `wait`, que le signal interrompt aussitôt. Le run en cours reçoit SIGINT
# (relayé par `timeout`) : Python lève KeyboardInterrupt et referme le navigateur au lieu d'être tué net.
# L'attente reçoit SIGTERM : un processus en arrière-plan d'un script ignore SIGINT.
stopping=0
child=0
child_signal=TERM
on_signal() {
  stopping=1
  log "arrêt demandé"
  [[ $child -ne 0 ]] && kill "-$child_signal" "$child" 2>/dev/null
}
trap on_signal TERM INT

# Attend `child` jusqu'au bout : un `wait` interrompu par le trap rend la main avant la fin du processus.
wait_child() {
  local status
  while :; do
    wait "$child"
    status=$?
    kill -0 "$child" 2>/dev/null || break
  done
  child=0
  return "$status"
}

run_target() {
  local slug="${1%%=*}" source_id="${1#*=}" status
  touch "$heartbeat_file"
  log "▶ $slug : track --from-api (source $source_id)"
  # --kill-after : si le run ignore l'interruption, il est tué 30 s plus tard (navigateur bloqué…).
  timeout --signal=INT --kill-after=30 "$run_timeout_s" \
    manhwa-scraper track --source-id "$source_id" --from-api "$slug" &
  child=$!
  child_signal=INT
  wait_child
  status=$?
  if [[ $stopping -eq 1 ]]; then
    log "■ $slug : run interrompu par l'arrêt du conteneur (code $status)"
    return
  fi
  case $status in
    0) log "✔ $slug : run terminé" ;;
    124 | 137) log "✖ $slug : run interrompu après ${run_timeout_s}s (SCRAPER_RUN_TIMEOUT_S)" ;;
    *) log "✖ $slug : run en échec (code $status), nouvel essai au prochain cycle" ;;
  esac
}

log "démarrage : ${#targets[@]} source(s), un cycle toutes les ${interval_s}s, run max ${run_timeout_s}s"
touch "$heartbeat_file"
while [[ $stopping -eq 0 ]]; do
  cycle_start=$(date +%s)
  for target in "${targets[@]}"; do
    [[ $stopping -eq 1 ]] && break
    run_target "$target"
  done
  [[ $stopping -eq 1 ]] && break

  # Cadence fixe : le prochain cycle part `interval` après le DÉBUT de celui-ci (pas de dérive avec la durée des
  # runs). Un cycle plus long que l'intervalle enchaîne directement sur le suivant, sans jamais se superposer.
  remaining_s=$((cycle_start + interval_s - $(date +%s)))
  if [[ $remaining_s -le 0 ]]; then
    log "⚠ cycle plus long que l'intervalle (${interval_s}s) : le suivant démarre tout de suite"
    continue
  fi
  log "prochain cycle dans ${remaining_s}s"
  touch "$heartbeat_file"
  sleep "$remaining_s" &
  child=$!
  child_signal=TERM
  wait_child
done
log "arrêté"
