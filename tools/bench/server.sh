#!/usr/bin/env bash
# Isolated server for benchmarks and headless tests (no HMR or file watching; port 5182, or a
# second one with PORT=5183 so experiments don't disturb a run). It caches transformed modules,
# so restart it after changing source:  tools/bench/server.sh [start|stop|restart]
cd "$(dirname "$0")/../.."
PORT=${PORT:-5182}
PIDF=/tmp/residue-bench-server-$PORT.pid
LOG=/tmp/residue-bench-server-$PORT.log
stop() { [ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null; rm -f $PIDF; sleep 0.5; }
start() {
  nohup node node_modules/vite/bin/vite.js --config vite.bench.config.js --port $PORT > $LOG 2>&1 &
  echo $! > $PIDF
  for i in $(seq 40); do curl -s -o /dev/null http://localhost:$PORT/ && { echo "bench server up on $PORT"; return; }; sleep 0.25; done
  echo "bench server failed:"; tail -5 $LOG; return 1
}
case "${1:-restart}" in start) start ;; stop) stop ;; restart) stop; start ;; esac
