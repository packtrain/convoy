# CLI Update Notice and `convoy update`

`convoy connect` and `convoy tui` tell the user when a newer `@useconvoy/cli`
is published, and offer to install it when someone is at the keyboard.
`convoy update` installs it.

## Notice (unattended connect)

- On connect start, the CLI fetches `https://registry.npmjs.org/@useconvoy/cli/latest`
  with a 1.5s timeout, in parallel with agent registration — it never delays
  startup.
- If the registry's `version` is greater than the running version
  (numeric major/minor/patch compare, `compareVersions`), one line prints after
  `Runtime config: …` and before `Waiting for commands…`:

  ```
  ↑ Update available: 0.49.3 → 0.50.0  ·  convoy update
  ```

- Anything else prints nothing: same version, older registry version (local dev
  build), non-200 response, malformed payload, timeout, or no network. The check
  never fails the connect.
- Skipped entirely in stream-replay mode (`--stream <file>`), so recorded runs
  stay deterministic and offline.
- Under `--json`, the line goes to stderr like every other human log line — see
  [cli-sidecar-contract.md](cli-sidecar-contract.md).

## Prompt (connect in a terminal, `convoy tui`)

Connect (`convoy`, `convoy connect`, setup's auto-connect) prompts instead of
printing the notice only when all of these hold:

- stdin and stdout are both TTYs,
- not `--json`, not a non-interactive caller (the project worker passes
  `nonInteractive`), not `--stream`,
- `CI` is unset.

Every unattended launcher fails the first check and keeps the notice: the
service (stdin `ignore`), the desktop app (stdin null, plus `--json`), systemd,
launchd, and pm2. AI agents running `convoy` from a shell tool have no TTY
either, and one-shot commands never check.

```
? Update available · 0.113.1 → 0.114.0
❯ Update now (runs `npm install -g @useconvoy/cli@latest`)
  Skip
enter continue · esc skip · skips in 10s
```

- To prompt, connect waits for the lookup (at most its 1.5s timeout) before
  registering. Unattended starts keep the parallel lookup.
- **Update now** runs `convoy update`. On success it prints
  `Updated. Run convoy connect again.` and exits 0: the running process is still
  the old code. If npm fails, connect continues on the current version.
- **Skip**, Esc, or 10s without a key: connect continues. The timeout covers a
  real TTY with nobody watching, e.g. `convoy connect` in a detached tmux
  session.
- Ctrl+C exits like any other prompt.
- A session-conflict retry does not prompt again; it prints the notice line.
- `convoy tui` shows the same prompt before rendering; on success it prints
  `Updated. Run convoy tui again.` and exits.

## `convoy update`

- Prints the running version, then runs `npm install -g @useconvoy/cli@latest`
  with inherited stdio, so npm's own output and prompts (e.g. a permissions
  error) reach the user unchanged.
- Exits with npm's exit code. If npm cannot be launched at all, prints
  `Could not run npm: …` and exits 1.
- No registry pre-check: npm is the source of truth and finishes quickly when
  the installed version is already `latest`. Offline, npm's error is the
  message.
- Takes no options and ignores profiles; the install is per machine, not per
  project.

## Deliberately not included

- No in-place self-update — `convoy update` is a thin wrapper over the install
  path from [docs/cli/install](../../apps/docs/content/docs/cli/install.mdx).
- No cached check timestamp: the lookup runs once per `connect` or `tui`
  process, which is already rare.
- No "skip until next version" option: Skip only covers the current run.
- No re-exec after updating: the user reruns the command.
- No notice on one-shot commands (`convoy tasks list`, …) — they are used in
  scripts, where a registry round trip and extra output are unwelcome.
- No package-manager detection: `convoy update` assumes a global npm install.
  Checkout users (`pnpm cli:dev`) pull instead.
- No enforcement: the notice is advisory. The server-side hard floor is
  [cli-minimum-version.md](cli-minimum-version.md).
