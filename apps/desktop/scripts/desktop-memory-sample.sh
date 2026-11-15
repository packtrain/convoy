#!/usr/bin/env bash
#
# OS-1360 — sample the Convoy desktop process tree's memory over time.
#
# The point is attribution: "the app used 800 GB" has to resolve to one PID and
# one metric before any fix can be judged. macOS reports several very different
# numbers, and only some of them mean retained memory:
#
#   RSS       resident pages, in KiB (what Activity Monitor's "Memory" approximates)
#   VSZ       reserved *address space*, in KiB — a JS engine reserves TBs here
#             while touching almost none of it. Large VSZ alone is not a leak.
#   footprint macOS "phys_footprint": dirty + compressed pages owned by the
#             process. This is the number to trust for a leak claim.
#
# Usage:
#   apps/desktop/scripts/desktop-memory-sample.sh                 # sample every 60s, forever
#   apps/desktop/scripts/desktop-memory-sample.sh 30 240          # every 30s, 240 samples
#
# Writes a CSV to ~/convoy-memory-<timestamp>.csv and prints a live summary.
# Stop with Ctrl-C; the CSV stays valid (one flushed line per sample).
#
# Analyse with:
#   apps/desktop/scripts/desktop-memory-report.sh ~/convoy-memory-<timestamp>.csv

set -uo pipefail

INTERVAL="${1:-60}"
MAX_SAMPLES="${2:-0}" # 0 = unbounded

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script reads macOS-specific metrics (footprint, phys_footprint)." >&2
  echo "Detected: $(uname -s). Run it on the Mac showing the growth." >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
CSV="${HOME}/convoy-memory-${STAMP}.csv"

echo "sample,epoch,iso_time,pid,ppid,role,rss_kib,vsz_kib,footprint_kib,cpu_pct,etime,swap_used_mib,command" >"$CSV"

# Classify a PID so the CSV can be grouped without re-parsing command lines.
# The three heaps behave very differently and must not be summed blindly.
classify() {
  local command="$1"
  case "$command" in
    *convoy*connect*) echo "cli-node" ;;
    *WebKit.WebContent*) echo "webkit-content" ;;
    *WebKit.Networking*) echo "webkit-network" ;;
    *WebKit.GPU*) echo "webkit-gpu" ;;
    *Convoy.app*|*convoy-desktop*) echo "desktop-main" ;;
    # Anything else already inside the scoped PID set belongs to the app (a
    # dev-server node, tsx, the login shell wrapper). It used to be dropped as
    # "other", which is how a 117-sample run recorded exactly one process.
    *) echo "app-other" ;;
  esac
}

# Scoping is genuinely awkward here, and getting it wrong in either direction
# ruins the measurement:
#
#   - Matching WebKit helpers by name alone sweeps in every other WebKit app on
#     the Mac (Safari, Slack, Electron), burying the app's numbers in noise.
#   - Scoping to the app's process TREE drops those helpers entirely: macOS
#     WebKit helpers are XPC services reparented to launchd (ppid 1), so they
#     are never descendants of the app that uses them.
#
# So: take the app's own tree (Rust main + any CLI children it spawned) AND the
# WebKit helpers whose XPC service name carries the app's bundle id. Helpers
# that cannot be attributed are reported separately rather than silently
# included or dropped — see the `unattributed-webkit` role.
BUNDLE_HINT="${CONVOY_BUNDLE_HINT:-Convoy}"

# Matches BOTH the packaged app and `pnpm desktop:dev`. Dev mode is a different
# process tree — `target/debug/convoy-desktop` plus a Vite server and the
# cargo/tauri-cli supervisor — and missing it is how an earlier run measured a
# healthy 21 MiB while the machine was actually being driven into swap.
find_main_pid() {
  # Newest match wins if a stale build is somehow still around.
  pgrep -f 'Convoy\.app/Contents/MacOS/Convoy|target/debug/convoy-desktop|target/release/convoy-desktop' 2>/dev/null \
    | tail -1
}

# Dev-mode siblings that are not descendants of the Rust binary: the Vite
# server and the tauri-cli/cargo wrapper that spawned it. Reported separately
# so "the app" is not silently narrowed to just the Rust process.
dev_toolchain_pids() {
  pgrep -f 'vite.*--port 1430|apps/desktop.*vite|tauri dev|tauri-cli' 2>/dev/null
}

# Transitive descendants of $1, via one ps snapshot (pid ppid pairs).
descendants_of() {
  local root="$1"
  ps -axo pid=,ppid= | awk -v root="$root" '
    { parent[$1] = $2; pids[n++] = $1 }
    END {
      wanted[root] = 1
      # Test with `in`: wanted[parent[pid]] would AUTO-CREATE the parent key,
      # which walks up to pid 1 and swallows every process on the machine.
      # Repeat until closed — ps order does not guarantee parents come first.
      changed = 1
      while (changed) {
        changed = 0
        for (i = 0; i < n; i++) {
          pid = pids[i]
          if (pid in wanted) continue
          if (pid in parent && (parent[pid] in wanted)) { wanted[pid] = 1; changed = 1 }
        }
      }
      for (pid in wanted) print pid
    }
  '
}

# WebKit helper PIDs attributable to this app. The full ps command line of an
# XPC helper usually carries the client's bundle id or app path; when it does
# not, the PID lands in the unattributed list instead of being guessed at.
webkit_helper_pids() {
  ps -axo pid=,command= \
    | grep -E 'WebKit\.(WebContent|Networking|GPU)' \
    | grep -v grep \
    | grep -iF "$BUNDLE_HINT" \
    | awk '{print $1}'
}

unattributed_webkit_pids() {
  ps -axo pid=,command= \
    | grep -E 'WebKit\.(WebContent|Networking|GPU)' \
    | grep -v grep \
    | grep -ivF "$BUNDLE_HINT" \
    | awk '{print $1}'
}

# phys_footprint in KiB. `-f bytes` is the only stable format — the default is
# human-readable ("57.6M"), which is what silently defeated the first version
# of this script. Empty when unavailable (tool missing, or the target is not
# ours and we are not root); RSS/VSZ always come from ps, so a sample is never
# empty. Both label spellings are accepted across macOS versions.
read_footprint() {
  local pid="$1"
  command -v footprint >/dev/null 2>&1 || { echo ""; return; }
  local value
  value="$(footprint -f bytes "$pid" 2>/dev/null | awk '
    tolower($0) ~ /(phys_footprint|physical footprint)[^_a-z]*:/ &&
    tolower($0) !~ /peak/ {
      # Last bare integer on the line is the value in bytes.
      for (i = NF; i >= 1; i--) {
        token = $i
        gsub(/[^0-9]/, "", token)
        if (token != "" && $i ~ /^[0-9,]+$/) { printf "%d\n", token / 1024; exit }
      }
    }
  ')"
  # A live process never has a 0 KiB footprint: 0 means the parse failed or
  # footprint(1) refused the process (it needs root for other users' PIDs).
  # Report it as unavailable so the reporter prints n/a, not a fake "+0.0".
  [[ -z "$value" || "$value" -eq 0 ]] && { echo ""; return; }
  echo "$value"
}

MAIN_PID="$(find_main_pid)"
if [[ -z "$MAIN_PID" ]]; then
  echo "Could not find the Convoy desktop process." >&2
  echo "Start the app first (pnpm desktop:dev, or launch Convoy.app), then rerun." >&2
  exit 1
fi

# Prove footprint parsing works before committing to a long run — a silent
# failure here is what invalidated the first measurement attempt.
PROBE="$(read_footprint "$MAIN_PID")"
if [[ -z "$PROBE" ]]; then
  echo "WARNING: phys_footprint is unavailable for PID ${MAIN_PID}." >&2
  echo "         Falling back to RSS, which undercounts compressed pages." >&2
  echo "         (footprint(1) needs root for processes you do not own.)" >&2
else
  echo "footprint OK: main PID ${MAIN_PID} at $((PROBE / 1024)) MiB phys_footprint"
fi

sample=0
echo "Sampling every ${INTERVAL}s → ${CSV}"
echo "Scoped to PID ${MAIN_PID}, its descendants, and WebKit helpers matching '${BUNDLE_HINT}'."
UNATTRIBUTED_COUNT="$(unattributed_webkit_pids | wc -l | tr -d ' ')"
if [[ "${UNATTRIBUTED_COUNT:-0}" -gt 0 ]]; then
  echo "Note: ${UNATTRIBUTED_COUNT} WebKit helper(s) could not be attributed to this app and are"
  echo "      EXCLUDED. If the app's WebView is missing from the CSV, set"
  echo "      CONVOY_BUNDLE_HINT to a string in its helper command line."
fi
echo "(Ctrl-C to stop. Leave the app idle for a clean baseline.)"
echo

while :; do
  sample=$((sample + 1))
  epoch="$(date +%s)"
  iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  total_rss=0
  total_footprint=0
  rows=0

  # Read once per sample, not per row.
  swap_now="$(sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p')"

  # Re-resolve each sample: WebKit helpers are spawned and reaped over time,
  # and the main PID changes across a dev-server rebuild.
  current_main="$(find_main_pid)"
  if [[ -n "$current_main" ]]; then
    MAIN_PID="$current_main"
  fi
  TREE_PIDS="$({
    descendants_of "$MAIN_PID"
    webkit_helper_pids
    dev_toolchain_pids
    # Any convoy connect child, wherever the supervisor put it.
    pgrep -f 'convoy.*connect' 2>/dev/null
  } | sort -un | tr '\n' ' ')"

  # One ps call, then filter — matches how the app's own supervisor reads the
  # table, and avoids N forks per sample.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    pid="$(awk '{print $1}' <<<"$line")"
    ppid="$(awk '{print $2}' <<<"$line")"
    rss="$(awk '{print $3}' <<<"$line")"
    vsz="$(awk '{print $4}' <<<"$line")"
    cpu="$(awk '{print $5}' <<<"$line")"
    etime="$(awk '{print $6}' <<<"$line")"
    command="$(cut -d' ' -f7- <<<"$(awk '{$1=$1};1' <<<"$line")")"

    role="$(classify "$command")"

    footprint_kib="$(read_footprint "$pid")"

    # Quote the command: it contains spaces and would break CSV columns.
    printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"%s"\n' \
      "$sample" "$epoch" "$iso" "$pid" "$ppid" "$role" \
      "$rss" "$vsz" "${footprint_kib:-}" "$cpu" "$etime" "${swap_now:-}" \
      "${command//\"/\'}" >>"$CSV"

    total_rss=$((total_rss + rss))
    [[ -n "$footprint_kib" ]] && total_footprint=$((total_footprint + footprint_kib))
    rows=$((rows + 1))

    # Flag a runaway live, rather than only in the post-hoc report: >64 GiB of
    # address space in one process is the shape that ends up as a TB-scale
    # figure in Activity Monitor.
    if [[ "$vsz" -gt 67108864 ]]; then
      printf '  !! pid %s (%s) VSZ %.1f GiB, RSS %.1f MiB — address space runaway\n' \
        "$pid" "$role" \
        "$(awk -v v="$vsz" 'BEGIN { print v / 1024 / 1024 }')" \
        "$(awk -v r="$rss" 'BEGIN { print r / 1024 }')"
    fi
  done < <(ps -axo pid=,ppid=,rss=,vsz=,%cpu=,etime=,command= \
    | awk -v pids="$TREE_PIDS" '
        BEGIN { split(pids, list, " "); for (i in list) wanted[list[i]] = 1 }
        wanted[$1]
      ' \
    | grep -v 'desktop-memory-sample')

  if [[ "$rows" -eq 0 ]]; then
    echo "[$iso] no Convoy processes found — is the desktop app running?"
  else
    printf '[%s] sample %-4s %s procs  rss=%s MiB' \
      "$iso" "$sample" "$rows" "$((total_rss / 1024))"
    [[ "$total_footprint" -gt 0 ]] && printf '  footprint=%s MiB' "$((total_footprint / 1024))"
    # System-wide swap is the metric that actually predicts the "out of
    # application memory" dialog, and it is cheap to read. A leak that shows up
    # nowhere else still shows up here.
    swap_used="$(sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p')"
    [[ -n "${swap_used:-}" ]] && printf '  swap_used=%.0f MiB' "$swap_used"
    printf '\n'
  fi

  if [[ "$MAX_SAMPLES" -gt 0 && "$sample" -ge "$MAX_SAMPLES" ]]; then
    echo
    echo "Done: $sample samples → $CSV"
    exit 0
  fi
  sleep "$INTERVAL"
done
