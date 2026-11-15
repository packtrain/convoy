# CLI Setup Non-Interactive Specification

This specification defines scriptable profile provisioning for `convoy setup`.

## Scope

- Command: `convoy setup`
- New behavior only applies when all required non-interactive inputs are provided.
- Existing interactive wizard behavior remains unchanged for partial/missing inputs,
  except that the interactive API-key step now defaults to browser login
  (see `cli-browser-login.md`): the wizard asks "How do you want to
  authenticate?" with **Log in with browser (recommended)** and **Paste an
  API key**. Passing `--api-key` (or running fully non-interactively) skips
  the question — pasted keys remain the scriptable/CI path.

## New Setup Options

- `--profile-key <key>`: Explicit profile key to write under `[profiles.<key>]`.
- `--path <path>`: Workspace folder path to save in the profile. Relative paths such as `.` are resolved against the current working directory before writing config.
- `-f, --force`: Allow overwrite when the profile key already exists.

Existing setup options stay compatible:

- `--url <url>`
- `--api-key <key>`
- `--project <id>`
- `--profile <name>` (display name only)

## Non-Interactive Trigger

`setup` runs in non-interactive mode only when all of the following are present:

- `url`
- `apiKey`
- `project`
- `profileKey`

When triggered:

- No prompts are shown.
- Credentials are still validated by querying accessible projects.
- Provided project must exist in accessible projects.
- If `--path` is provided, it must resolve to an existing directory.
- If `--path` is omitted, the current working directory is saved for backward compatibility.
- Profile is written to config.
- Command exits successfully without starting the long-running agent connection.

## Interactive Workspace Path

When setup is interactive or partially prefilled, the wizard prompts for the workspace folder before saving the profile unless `--path` is provided.

- Prompt copy: `Press Enter to use <current-path>, or type another path:`
- Pressing Enter uses the current working directory.
- Typed relative paths are resolved to absolute paths.
- The resolved path must exist and be a directory.

## Profile Naming Rules

- Profile key validation uses: `^[a-z][a-z0-9_-]*$`.
- Profile display name resolution:
  - Use `--profile` if provided.
  - Otherwise use selected project name.
  - Fallback to current directory basename if needed.

## Existing Key Behavior

- If profile key exists and `--force` is not set: fail with non-zero exit code.
- If profile key exists and `--force` is set: overwrite profile entry.

## Backward Compatibility

- Interactive wizard prompts remain the default unless non-interactive trigger fields are fully provided.
- Existing fully non-interactive invocations that omit `--path` continue saving the current working directory.
- `--profile` keeps its existing meaning as display name in `setup`.
- Global `--profile` resolution semantics outside `setup` are unchanged.

## Managed Linux registrations

OS-1960 preserves project add --non-interactive inputs. Successful add commits
through a reachable service and reports registration/application separately from
online status. Offline add never starts a service. project remove --yes confirms
unregistration; --interrupt separately authorizes stopping a live service worker.
See [the service contract](cli-service.md#live-registration-os-1960).

## Pick or create (OS-1961)

Setup and isolated project add share project selection. The interactive selector
lists Create a new project first, followed by a separator line and then the
projects grouped by organization, so the option never reads as part of one
organization. `--create --org <id-or-slug> --project-name <name>
--project-alias <alias>` replaces `--project` for complete non-interactive setup.
`--non-interactive` explicitly rejects missing inputs instead of prompting.
Creation uses the authenticated user's existing organizations, even when empty.
Aliases are normalized to uppercase and validated before creation. The server
checks scope, organization permissions and uniqueness. Setup retains its existing
profile/path and direct-connection behavior. Isolated registration instead uses
the narrowed worker credential described in cli-project-isolation.md.

A confirmed creation prints its ID before local profile writes or connection.
Failures retain the project. An uncertain creation response directs the user to
inspect remote state before retrying, never automatically creating another one.

### Interactive creation defaults

When --project-name is omitted, the name prompt defaults to the
provided setup profile display name, otherwise --profile-key. Enter accepts
that value; typing replaces it. The alias prompt suggests initials from the
chosen name, or up to three characters for a single word, normalized to the
2-5 character alias grammar. Numeric names get a P prefix, single characters
are padded with P, and names without ASCII letters/digits suggest PRJ. Users
can replace the suggestion. Explicit --project-name and --project-alias bypass
the respective prompts. Non-interactive creation still requires both flags.

### Local preflight

Before creation, including the interactive selector path, obtain and validate the
profile key and workspace directory. Reject an existing profile unless --force
was provided. Repeat the conflict check before saving to catch changes during
remote operations. Isolated project add checks profile ownership and workspace/
worktree overlap before creation, then checks the full identity at registration.
Existing-project registration still permits refreshing an identical profile.
