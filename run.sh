#!/usr/bin/env bash
# run.sh — levantar/gestionar reporter (web + watcher + scheduler).
#
# El servidor Next arranca TODO: la UI, el watcher de ficheros y el scheduler
# de monitorización (instrumentation.ts). Orca y las tools de recon son
# binarios externos que se lanzan bajo demanda, no hace falta arrancarlos aquí.
#
# Uso:
#   ./run.sh [start]     arranca en segundo plano y espera a que responda
#   ./run.sh stop        lo para
#   ./run.sh restart     stop + start
#   ./run.sh status      ¿está vivo? ¿responde?
#   ./run.sh logs        sigue el log en vivo (Ctrl-C para salir)
#   ./run.sh dev         arranca en PRIMER PLANO (logs en la terminal)
set -euo pipefail

cd "$(dirname "$0")"

HOST=127.0.0.1
PORT=3100
URL="http://$HOST:$PORT"
PIDFILE=.reporter.pid
LOGFILE=.reporter.log

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

preflight() {
  command -v pnpm >/dev/null 2>&1 || die "pnpm no está instalado (requiere Node 22 + pnpm)."
  [ -f .env.local ] || die ".env.local no existe. Define REPORTS_ROOT (y API_TOKEN) — ver README."
  grep -q '^REPORTS_ROOT=' .env.local || die "REPORTS_ROOT no está en .env.local (el server no arranca sin ella)."
  if [ ! -d node_modules ]; then
    say "• node_modules ausente: instalando dependencias…"
    pnpm install
  fi
}

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

responds() { curl -fsS -o /dev/null --max-time 3 "$URL/" 2>/dev/null; }

start() {
  preflight
  if pid="$(running_pid)"; then
    say "ya está corriendo (pid $pid) → $URL"; return 0
  fi
  say "• arrancando reporter en $URL …"
  # setsid: grupo de proceso propio para poder pararlo entero (incluido next)
  setsid pnpm dev >"$LOGFILE" 2>&1 < /dev/null &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    if responds; then say "✓ listo → $URL   (logs: ./run.sh logs)"; return 0; fi
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      say "✗ el servidor murió al arrancar. Últimas líneas del log:"; tail -n 25 "$LOGFILE" || true
      rm -f "$PIDFILE"; return 1
    fi
    sleep 1
  done
  die "no respondió en 60 s. Revisa $LOGFILE."
}

stop() {
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "${pid:-}" ]; then
    # matar el GRUPO (pnpm + next hijo); fallback al pid directo
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
  # por si acaso, cualquier next dev en este puerto
  pkill -f "next dev -p $PORT" 2>/dev/null || true
  rm -f "$PIDFILE"
  say "• parado."
}

status() {
  if pid="$(running_pid)"; then
    if responds; then say "✓ vivo (pid $pid) y responde → $URL"
    else say "… proceso vivo (pid $pid) pero aún no responde en $URL"; fi
  else
    say "✗ parado."
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  logs)    exec tail -n 50 -f "$LOGFILE" ;;
  dev)     preflight; exec pnpm dev ;;   # primer plano
  *)       die "uso: ./run.sh [start|stop|restart|status|logs|dev]" ;;
esac
