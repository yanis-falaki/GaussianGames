#!/usr/bin/env bash
# Isolated benchmark server (port 5182, no HMR/watch). It caches transformed modules, so
# restart it after changing source:  tools/bench-server.sh restart
cd "$(dirname "$0")/.."
PIDF=/tmp/residue-bench-server.pid
stop() { [ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null; rm -f $PIDF; sleep 0.5; }
start() {
  nohup npx vite --config vite.bench.config.js > /tmp/residue-bench-server.log 2>&1 &
  echo $! > $PIDF
  for i in $(seq 40); do curl -s -o /dev/null http://localhost:5182/ && { echo "bench server up"; return; }; sleep 0.25; done
  echo "bench server failed:"; tail -5 /tmp/residue-bench-server.log; return 1
}
case "${1:-restart}" in start) start ;; stop) stop ;; restart) stop; start ;; esac
