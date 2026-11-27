#!/usr/bin/env bash
# Upgrades a Docker install to the latest main, deploying each upgrade stop on the way.
# Use it instead of git pull. See docs/specs/automatic-migrations.md#upgrade-stops.
set -euo pipefail

# Checkout replaces this file, so bash must parse the whole body before the first one.
main() {
  cd "$(dirname "$0")"
  say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "The checkout has uncommitted changes. Commit or discard them, then run this again:"
    git status --short --untracked-files=no
    exit 1
  fi
  git fetch --quiet --tags origin

  local stops
  stops="$(git tag --merged origin/main --no-merged HEAD --list 'upgrade-stop-*' --sort=version:refname)"
  # A run that failed at a stop left HEAD detached there; deploy that stop again first.
  if ! git symbolic-ref -q HEAD >/dev/null; then
    stops="$(git tag --points-at HEAD --list 'upgrade-stop-*')"$'\n'"$stops"
  fi
  for tag in $stops; do
    say "Deploying upgrade stop $tag..."
    git checkout --quiet "$tag"
    ./start.sh
  done

  say "Deploying the latest main..."
  git checkout --quiet main
  git merge --quiet --ff-only origin/main
  ./start.sh
}

main "$@"; exit
