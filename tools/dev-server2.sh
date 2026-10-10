#!/usr/bin/env bash
# A second isolated server (port 5183) so experiments don't disturb a run on 5182.
cd "$(dirname "$0")/.."
PIDF=/tmp/residue-dev2.pid
[ -f $PIDF ] && kill "$(cat $PIDF)" 2>/dev/null; sleep 0.5
nohup npx vite --config vite.bench.config.js --port 5183 > /tmp/residue-dev2.log 2>&1 &
echo $! > $PIDF
for i in $(seq 40); do curl -s -o /dev/null http://localhost:5183/ && { echo "server2 up"; exit 0; }; sleep 0.25; done
echo "failed"; tail -5 /tmp/residue-dev2.log
