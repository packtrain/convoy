#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "${1:-default}" in
  default)
    config="$repo_root/.devcontainer/devcontainer.json"
    ;;
  sandbox)
    config="$repo_root/sandbox/.devcontainer/devcontainer.json"
    ;;
  *)
    echo "Usage: bash scripts/devcontainer.sh [default|sandbox]" >&2
    exit 1
    ;;
esac

if ! command -v devcontainer >/dev/null 2>&1; then
  echo "Missing devcontainer CLI. Install it with: npm install -g @devcontainers/cli" >&2
  exit 1
fi

if [[ ! -f "$config" ]]; then
  echo "Devcontainer config not found: $config" >&2
  exit 1
fi

cd "$repo_root"
devcontainer up --workspace-folder "$repo_root" --config "$config"
exec devcontainer exec --workspace-folder "$repo_root" --config "$config" zsh
