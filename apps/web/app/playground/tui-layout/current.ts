// Frames captured from the real TUI at 110×34 (0.169.1), colors stripped.
export const CURRENT_FRAMES = {
  overview: ` convoy  local-test / docker                                                 client 0.169.1 · service 0.169.1
 docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock   2 registered projects

 ENVIRONMENTS                  Details  local-test
 + Add environment
                               Project notices [w] Details
 ▾ local-test       docker ●   os · online
   Actions                       Codex is not signed in.
   Credentials
   + Add project               [s] Inspect status  [f] Retry connection  [+] Add project

 ⡖ os                      ●   Environment
   landing                 ●     Connection     connected
                                 Mode           shared · one account for all projects
 ▸ build-box           ssh ●     Version        client 0.169.1 · service 0.169.1
                                 Service        running · PID 1042691 · Node v22.23.5
                                 Configuration  valid
                                 Endpoint       docker exec convoy-local-test-0f079851 /home/node/.convoy/se…
                                 Epoch          80272f7d-eca5-4c6d-90ab-0a7df4b850f7

                               Runtimes
                                 RUNTIME      VERSION             LOGIN       PROJECT  CREDENTIAL
                                 Codex        0.171.0             signed out  os       native
                                   [l] Sign in   [u] Update
                                   Credentials need a shared environment, a managed Docker target or a Linux
                                   project environment
                                                                              landing  native
                                 Claude Code  2.1.330             signed out  os       native
                                 Cursor       2026.10.22-27dcf5f  unknown     os       native

                               Projects
                               [←/→] panes  [↑/↓] select  [Enter] activate  [Esc] back  [m] select text  [n/…
 ● connected   local-test · docker   1 observed active · queued count unknown`,
  actions: ` convoy  local-test / docker                                                 client 0.169.1 · service 0.169.1
 docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock   2 registered projects

 ENVIRONMENTS                  Actions  local-test
 + Add environment
                               Project notices [w] Details
 ▾ local-test       docker ●   os · online
   Actions                       Codex is not signed in.
   Credentials
   + Add project               Service
                               > [l] Saved service JSON logs
 ⢲ os                      ●     [b] Start shared service · unavailable
   landing                 ●     [x] Stop shared service
                                 [t] Restart service
 ▸ build-box           ssh ●   Maintenance
                                 [u] Update CLI
                                 [r] Agent runtimes
                               Container
                                 [g] Start environment / recover
                                 [z] Stop environment
                                 [D] Delete environment
                               Enter to choose · Esc back









                               [←/→] panes  [↑/↓] select  [Enter] activate  [Esc] back  [m] select text  [n/…
 ● connected   local-test · docker   1 observed active · queued count unknown`,
  credentials: ` convoy  local-test / docker                                                 client 0.169.1 · service 0.169.1
 docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock   2 registered projects

 ENVIRONMENTS                  Credentials  local-test
 + Add environment
                               Project notices [w] Details
 ▾ local-test       docker ●   os · online
   Actions                       Codex is not signed in.
   Credentials
   + Add project               Runtime credentials are unavailable for this environment.
                               Managed runtime credentials live in a shared environment, a managed Docker tar
 ⣠ os                      ●   get or a Linux project VM run as its control account.
   landing                 ●   Provider keys of ordinary profiles on this machine stay in convoy keys and the
                                desktop settings. This TUI does not change them.
 ▸ build-box           ssh ●
















                               [←/→] panes  [↑/↓] select  [Enter] activate  [Esc] back  [m] select text  [n/…
 ● connected   local-test · docker   1 observed active · queued count unknown`,
  runs: ` convoy  local-test / docker                                                 client 0.169.1 · service 0.169.1
 docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock   2 registered projects

 ENVIRONMENTS                   [r] Runs    [a] Actions   local-test / os
 + Add environment
                               Project notices [w] Details
 ▾ local-test       docker ●   os · online
   Actions                       Codex is not signed in.
   Credentials
   + Add project               Runs  os · page 1                                            5 threads on page

 ⢰ os                      ●    THREAD / TASK                   PROJECT         STATE            UPDATED
   landing                 ●    › [OS-2481] · os1               os              ● streaming      22s ago
                                  Fix the flaky login test in…  runtime unkno…
 ▸ build-box           ssh ●
                                  [OS-2477] · os2               os              ? waiting_input  5m 02s ago
                                  Review PR #812: billing web…  runtime unkno…

                                  [no task] · os3               os              ✓ completed      1h 00m ago
                                  sup?                          runtime unkno…

                                  [task unavailable] · os4      os              ! failed         1d 0h ago
                                  Investigate memory growth i…  runtime unkno…

                                  [no task] · os5               os              · idle+queued    2h 00m ago
                                  Queued follow-up              runtime unkno…





                               [←/→] panes  [↑/↓] select  [Enter] activate  [Esc] back  [m] select text  [n/…
 ● connected   local-test · docker   1 observed active · queued count unknown   page updated 5:15:58 AM`,
  projectActions: ` convoy  local-test / docker                                                 client 0.169.1 · service 0.169.1
 docker exec convoy-local-test-0f079851 /home/node/.convoy/service/control.sock   2 registered projects

 ENVIRONMENTS                   [r] Runs    [a] Actions   local-test / os
 + Add environment
                               Project notices [w] Details
 ▾ local-test       docker ●   os · online
   Actions                       Codex is not signed in.
   Credentials
   + Add project               Project
                               > [p] Pause project
 ⢲ os                      ●     [u] Reload project
   landing                 ●     [h] Private project shell
                                 [e] Check project · unavailable
 ▸ build-box           ssh ●     [v] Remove project from environment
                               Credentials
                                 [t] Runtime access · unavailable
                                 [c] Assign or unassign credentials · unavailable
                               Enter to choose · Esc back












                               [←/→] panes  [↑/↓] select  [Enter] activate  [Esc] back  [m] select text  [n/…
 ● connected   local-test · docker   1 observed active · queued count unknown   page updated 5:16:00 AM`,
};
