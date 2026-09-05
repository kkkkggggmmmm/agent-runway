#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  chown agentrunway:agentrunway /home/agentrunway
  install -d -m 0700 -o agentrunway -g agentrunway /home/agentrunway/state
  exec gosu agentrunway "$@"
fi

exec "$@"
