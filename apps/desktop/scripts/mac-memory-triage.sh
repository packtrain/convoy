#!/usr/bin/env bash
#
# OS-1360 — one-shot triage: which processes on this Mac are actually huge,
# ranked, with no assumption about who parented whom.
#
# Written because a tree-scoped sampler missed the target entirely: macOS
# WebKit helpers are XPC services reparented to launchd (ppid 1), so they are
# NOT descendants of the app that uses them. Anything that scopes by process
# tree silently drops the WebView heaps.
#
# Prints three views:
#   1. Top processes by phys_footprint (real retained memory)
#   2. Top processes by VSZ (reserved address space — usually NOT a leak)
#   3. The full process tree of a named process, if given
#
# Usage:
#   apps/desktop/scripts/mac-memory-triage.sh              # top 25 overall
#   apps/desktop/scripts/mac-memory-triage.sh cmux         # also expand cmux's tree
#   apps/desktop/scripts/mac-memory-triage.sh cmux 40      # ...with a longer top list

set -uo pipefail

FOCUS="${1:-}"
TOP_N="${2:-25}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS only (reads phys_footprint / VSZ semantics specific to Darwin)." >&2
  exit 1
fi

have_footprint=0
command -v footprint >/dev/null 2>&1 && have_footprint=1

# phys_footprint in KiB, or empty. `-f bytes` because the default format is
# human-readable ("57.6M") and silently defeats numeric parsing.
# phys_footprint in KiB, or empty when genuinely unavailable. Two traps:
#   - `_peak` lines must not be mistaken for the current value.
#   - A parsed 0 means the parse failed or footprint refused the process (it
#     needs root for processes you don't own). No live process has a 0 KiB
#     footprint, so 0 is reported as unavailable rather than as "flat" — the
#     earlier version printed 0.0 and made broken reads look like evidence.
read_footprint() {
  [[ "$have_footprint" -eq 1 ]] || { echo ""; return; }
  local value
  value="$(footprint -f bytes "$1" 2>/dev/null | awk '
    tolower($0) ~ /(phys_footprint|physical footprint)[^_a-z]*:/ &&
    tolower($0) !~ /peak/ {
      for (i = NF; i >= 1; i--) {
        if ($i ~ /^[0-9,]+$/) { t = $i; gsub(/[^0-9]/, "", t); if (t != "") { printf "%d\n", t / 1024; exit } }
      }
    }')"
  [[ -z "$value" || "$value" -eq 0 ]] && { echo ""; return; }
  echo "$value"
}

echo "=== Memory triage $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo
echo "Physical RAM: $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 )) GiB"
echo "Swap:         $(sysctl -n vm.swapusage)"
echo
echo "Any single-process number far above physical RAM is address space or an"
echo "accounting artifact, not resident memory. Compare columns before blaming."
echo

# ---- 1. by VSZ (cheap: straight from ps, no per-PID forks) ----
echo "--- Top ${TOP_N} by VSZ (reserved address space, GiB) ---"
printf '%12s %8s %10s %10s  %s\n' "VSZ_GiB" "PID" "RSS_MiB" "%CPU" "COMMAND"
ps -axo vsz=,pid=,rss=,%cpu=,comm= \
  | sort -rn \
  | head -"$TOP_N" \
  | awk '{
      vsz_gib = $1 / 1024 / 1024
      rss_mib = $3 / 1024
      cmd = ""
      for (i = 5; i <= NF; i++) cmd = cmd (i > 5 ? " " : "") $i
      printf "%12.2f %8s %10.1f %10s  %s\n", vsz_gib, $2, rss_mib, $4, substr(cmd, 1, 70)
    }'
echo

# ---- 2. by RSS, then footprint for just those (bounded forks) ----
echo "--- Top ${TOP_N} by RSS, with phys_footprint ---"
if [[ "$have_footprint" -eq 0 ]]; then
  echo "(footprint(1) not found — RSS only. It undercounts compressed pages.)"
fi
printf '%10s %10s %8s  %s\n' "RSS_MiB" "FOOT_MiB" "PID" "COMMAND"
while read -r rss pid comm; do
  [[ -z "${pid:-}" ]] && continue
  foot_kib="$(read_footprint "$pid")"
  if [[ -n "$foot_kib" ]]; then
    foot_str="$(awk -v k="$foot_kib" 'BEGIN { printf "%.1f", k / 1024 }')"
  else
    foot_str="n/a"
  fi
  awk -v r="$rss" -v f="$foot_str" -v p="$pid" -v c="$comm" \
    'BEGIN { printf "%10.1f %10s %8s  %s\n", r / 1024, f, p, substr(c, 1, 70) }'
done < <(ps -axo rss=,pid=,comm= | sort -rn | head -"$TOP_N")
echo

# ---- 3. focused tree ----
if [[ -n "$FOCUS" ]]; then
  echo "--- Processes matching '${FOCUS}' (and their children) ---"
  # macOS ships bash 3.2: no mapfile/readarray, and an empty array expands as
  # unset under `set -u`. Track the count separately and use a plain string.
  focus_pids=""
  focus_count=0
  while read -r matched_pid; do
    [[ -z "$matched_pid" ]] && continue
    focus_pids="${focus_pids}${matched_pid} "
    focus_count=$((focus_count + 1))
  done < <(pgrep -if "$FOCUS" 2>/dev/null)
  if [[ "$focus_count" -eq 0 ]]; then
    echo "No process matches '${FOCUS}' — it may already be gone."
  else
    printf '%10s %10s %8s %8s %12s  %s\n' "RSS_MiB" "FOOT_MiB" "PID" "PPID" "VSZ_GiB" "COMMAND"
    total_rss=0
    total_vsz=0
    for pid in $focus_pids; do
      # The match itself plus anything it parented directly.
      for target in "$pid" $(pgrep -P "$pid" 2>/dev/null); do
        row="$(ps -o rss=,vsz=,ppid=,command= -p "$target" 2>/dev/null)"
        [[ -z "$row" ]] && continue
        rss="$(awk '{print $1}' <<<"$row")"
        vsz="$(awk '{print $2}' <<<"$row")"
        ppid="$(awk '{print $3}' <<<"$row")"
        cmd="$(awk '{ for (i = 4; i <= NF; i++) printf "%s%s", (i > 4 ? " " : ""), $i }' <<<"$row")"
        foot_kib="$(read_footprint "$target")"
        if [[ -n "$foot_kib" ]]; then
          foot_str="$(awk -v k="$foot_kib" 'BEGIN { printf "%.1f", k / 1024 }')"
        else
          foot_str="n/a"
        fi
        awk -v r="$rss" -v v="$vsz" -v f="$foot_str" -v p="$target" -v pp="$ppid" -v c="$cmd" \
          'BEGIN { printf "%10.1f %10s %8s %8s %12.2f  %s\n", r / 1024, f, p, pp, v / 1024 / 1024, substr(c, 1, 60) }'
        total_rss=$((total_rss + rss))
        total_vsz=$((total_vsz + vsz))
      done
    done
    echo
    awk -v r="$total_rss" -v v="$total_vsz" \
      'BEGIN { printf "Subtotal: RSS %.1f MiB   VSZ %.2f GiB\n", r / 1024, v / 1024 / 1024 }'
    echo "(Summed VSZ across a tree is meaningless as 'memory used' — shared and"
    echo " reserved ranges are counted repeatedly. This is how a TB-scale number"
    echo " appears in a UI that adds it up.)"
  fi
  echo
fi

echo "--- WebKit helpers (never children of their app: launchd owns them) ---"
ps -axo rss=,vsz=,pid=,ppid=,command= \
  | grep -E 'WebKit\.(WebContent|Networking|GPU)' \
  | grep -v grep \
  | awk '{
      cmd = ""
      for (i = 5; i <= NF; i++) cmd = cmd (i > 5 ? " " : "") $i
      printf "%10.1f MiB rss  %8.2f GiB vsz  pid %-7s ppid %-7s %s\n", \
        $1 / 1024, $2 / 1024 / 1024, $3, $4, substr(cmd, 1, 60)
    }' \
  | sort -rn | head -15
