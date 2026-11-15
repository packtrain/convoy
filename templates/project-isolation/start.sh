#!/bin/sh
set -eu
if [ "${DEVCONTAINER_NETWORK_MODE:-strict}" = strict ]; then
  /usr/local/bin/init-firewall.sh
fi
exec /usr/bin/python3 -I /usr/local/share/convoy-projects/install.py \
  --control-user node --workspace /workspace \
  --package-root /opt/convoy/node_modules/@useconvoy/cli
