#!/usr/bin/env bash
set -euo pipefail

mkdir -p /workspace/node_modules
chown -R node:node /workspace/node_modules
# Per-package node_modules volumes (sandbox) start root-owned.
for d in /workspace/apps/*/node_modules /workspace/playground/*/node_modules; do
  if mountpoint -q "$d"; then chown node:node "$d"; fi
done
