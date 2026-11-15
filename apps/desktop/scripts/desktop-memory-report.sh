#!/usr/bin/env bash
#
# OS-1360 — summarise a desktop-memory-sample.sh CSV: per-PID growth, and the
# VSZ-vs-footprint verdict that decides whether there is a leak at all.
#
# Usage: apps/desktop/scripts/desktop-memory-report.sh ~/convoy-memory-<timestamp>.csv

set -uo pipefail

CSV="${1:-}"
if [[ -z "$CSV" || ! -f "$CSV" ]]; then
  echo "Usage: $0 <csv from desktop-memory-sample.sh>" >&2
  exit 1
fi

awk -F',' '
  NR == 1 { next }
  {
    pid = $4; role = $6; rss = $7 + 0; vsz = $8 + 0; foot = ($9 == "" ? "" : $9 + 0)
    swap = ($12 == "" ? "" : $12 + 0)
    key = role "/" pid
    if (!(key in first_seen)) {
      first_seen[key] = 1
      order[++n] = key
      first_rss[key] = rss; first_vsz[key] = vsz; first_foot[key] = foot
      first_t[key] = $2 + 0
    }
    last_rss[key] = rss; last_vsz[key] = vsz; last_foot[key] = foot
    last_t[key] = $2 + 0
    # Peaks matter more than endpoints: a process can balloon and be reaped
    # between samples, leaving flat first/last deltas and no trace of the spike.
    if (rss > peak_rss[key]) peak_rss[key] = rss
    if (vsz > peak_vsz[key]) peak_vsz[key] = vsz
    if (foot != "" && foot > peak_foot[key]) peak_foot[key] = foot
    samples[key]++
    # System-wide swap: the metric that actually predicts the macOS
    # "out of application memory" dialog.
    if (swap != "") {
      if (first_swap == "") first_swap = swap
      last_swap = swap
      if (swap > peak_swap) peak_swap = swap
    }
    # Count distinct PIDs per role to catch process *churn* (a supervisor that
    # respawns children forever leaks even if each child is small).
    seen_pid[role "|" pid] = 1
    role_names[role] = 1
  }
  END {
    if (n == 0) { print "No data rows."; exit 1 }

    printf "%-24s %6s %9s %9s %9s %10s %11s\n", "ROLE/PID", "SAMP", "RSS MiB", "dRSS MiB", "dFOOT MiB", "peakRSS", "peakVSZ GiB"
    printf "%-24s %6s %9s %9s %9s %10s %11s\n", "--------", "----", "-------", "--------", "---------", "-------", "-----------"

    for (i = 1; i <= n; i++) {
      key = order[i]
      d_rss = (last_rss[key] - first_rss[key]) / 1024
      d_vsz = (last_vsz[key] - first_vsz[key]) / 1024
      # A blank footprint means the metric was unavailable, NOT that it was
      # flat — printing 0.0 there once made a broken parse look like evidence.
      if (first_foot[key] != "" && last_foot[key] != "") {
        d_foot = (last_foot[key] - first_foot[key]) / 1024
        foot_str = sprintf("%+.1f", d_foot)
        total_d_foot += d_foot
        foot_rows++
      } else {
        foot_str = "n/a"
        missing_foot++
      }
      printf "%-24s %6d %9.1f %+9.1f %9s %10.1f %11.2f\n", \
        key, samples[key], last_rss[key] / 1024, d_rss, foot_str, \
        peak_rss[key] / 1024, peak_vsz[key] / 1024 / 1024

      total_d_rss += d_rss
      total_d_vsz += d_vsz
      total_peak_rss += peak_rss[key]
      if (last_t[key] > max_t) max_t = last_t[key]
      if (min_t == 0 || first_t[key] < min_t) min_t = first_t[key]
    }

    # Only trust footprint if every row reported it; a partial set would sum
    # apples and gaps.
    have_foot = (foot_rows > 0 && missing_foot == 0)

    elapsed_min = (max_t - min_t) / 60
    printf "\nWindow: %.1f min   Processes: %d\n", elapsed_min, n
    printf "Total dRSS: %+.1f MiB", total_d_rss
    if (have_foot) printf "   Total dFOOT: %+.1f MiB", total_d_foot
    printf "   Total dVSZ: %+.1f MiB\n", total_d_vsz

    if (elapsed_min > 0) {
      printf "Rate: %+.2f MiB/min RSS", total_d_rss / elapsed_min
      if (have_foot) printf "   %+.2f MiB/min footprint", total_d_foot / elapsed_min
      printf "\n"
    }

    # Process churn: more distinct PIDs than concurrent rows means something is
    # respawning. Endpoint deltas cannot see this at all.
    for (rp in seen_pid) { split(rp, parts, "|"); pid_count[parts[1]]++ }
    churn_note = ""
    for (r in role_names) {
      if (pid_count[r] > 4) {
        churn_note = churn_note sprintf("    %s: %d distinct PIDs over the window\n", r, pid_count[r])
      }
    }
    if (churn_note != "") {
      print "\nProcess churn (repeated spawn/exit — a leak source that per-PID deltas miss):"
      printf "%s", churn_note
    }

    if (first_swap != "" && last_swap != "") {
      printf "\nSystem swap used: %.0f → %.0f MiB (peak %.0f)\n", first_swap, last_swap, peak_swap
      print  "  Swap is what triggers the macOS out-of-application-memory dialog. It is"
      print  "  machine-wide, so growth here is not proof this app caused it — but a"
      print  "  crash with flat swap means the crash came from something else."
    }

    print "\nVerdict:"
    growth = have_foot ? total_d_foot : total_d_rss
    metric = have_foot ? "footprint" : "RSS"
    swap_grew = (first_swap != "" && last_swap != "" && (last_swap - first_swap) > 2000)

    if (swap_grew && growth < 50) {
      printf "  SWAP GREW (%+.0f MiB) WITHOUT THIS APP GROWING (%s %+.1f MiB).\n", last_swap - first_swap, metric, growth
      print  "  Either the pressure comes from other processes, or the growth is in a"
      print  "  process the sampler is not watching. Cross-check with:"
      print  "      apps/desktop/scripts/mac-memory-triage.sh"
      print  "  and confirm this app has PIDs in the table above at all."
    } else if (growth > 50 && total_d_vsz > 0) {
      printf "  LEAK-LIKE: %s grew %+.1f MiB. Attribute to the worst ROLE/PID above,\n", metric, growth
      print  "  then profile that process specifically (Instruments Allocations for"
      print  "  desktop-main, Web Inspector heap snapshots for webkit-content,"
      print  "  --heapsnapshot-signal for cli-node)."
    } else if (total_d_vsz > 500 && growth < 20) {
      printf "  ADDRESS SPACE ONLY: VSZ grew %+.1f MiB while %s stayed flat (%+.1f MiB).\n", total_d_vsz, metric, growth
      print  "  This is reservation, not retention — it is what an enormous"
      print  "  Activity Monitor number usually turns out to be. Not a leak."
    } else {
      printf "  STABLE: %s moved %+.1f MiB over %.1f min. Either there is no leak on\n", metric, growth, elapsed_min
      print  "  this code path, or the window was too short / the app too idle to"
      print  "  reproduce. Sample across the workload that originally triggered it."
    }
    if (!have_foot) {
      printf "\n  NOTE: phys_footprint was missing for %d of %d rows, so this verdict\n", missing_foot, n
      print  "  rests on RSS. RSS undercounts compressed pages, so a footprint-based"
      print  "  run is more trustworthy. Check the startup warning from the sampler."
    }
  }
' "$CSV"
