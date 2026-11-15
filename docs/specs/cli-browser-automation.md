# Environment-owned browser automation

OS-2262 replaces the OS-1992 Convoy browser wrapper with standalone upstream
tooling. CLI 0.128.0 removes all browser commands, managed smoke forwarding and
the Playwright package dependency. There are no compatibility stubs. Convoy runs
without browser tooling; it only handles attachment delivery.

## Image contract

Every shipped image installs the `@playwright/cli` release pinned by its
`PLAYWRIGHT_CLI_VERSION` build arg (0.1.21) under the root-owned
`/usr/local/lib/playwright-cli`, exposes `playwright-cli` on PATH and installs
that package's Chromium and OS dependencies during image build.
Binaries live in `/usr/local/share/ms-playwright`. The image writes
`/usr/local/share/playwright-cli/config.json` with the resolved executable path,
headless Chromium and explicit `chromiumSandbox: false` for the outer container
boundary. There is no automatic sandbox fallback or host configuration change.

The existing read-only /usr mount exposes tools and configuration inside isolated
projects. Runtime state belongs to the invoking project's private HOME/workspace.
No shared profiles, host cookies, or debugging ports are configured.
No runtime downloads are needed.

Every `@playwright/cli` release depends on a Playwright alpha, so its Chromium
revision never matches a stable Playwright. The pin is therefore exact and the
image carries one Chromium. Repository scripts that need a browser, the landing
tests and README screenshots, launch that same binary through the config file's
`executablePath` (`apps/landing/lib/browser.mjs`) and fall back to Playwright's
own lookup outside the container. Re-pin by changing the build arg in all three
Dockerfiles together; `install.test.ts` keeps them equal.

## Lifecycle and migration

Browser upgrades require rebuilding the image. CLI updates and rollback never
download, launch or check Chromium. Managed containers no longer create or mount
browser cache volumes, nor add browser download domains to the runtime firewall.
Legacy browser profiles are left untouched. The retired `browsers` volume stays
through rebuild and is removed by `environment delete` after the same ownership
check as current volumes. New image binaries cannot be hidden by an old cache mount.

Existing scripts must migrate to upstream commands; login/profile formats are
not automatically converted. Template READMEs document the installed tooling.
The repository's AGENTS.md owns its browser guidance. Convoy never injects browser
availability or installed-skill assumptions into runtime prompts and never writes
browser guidance into users' project instructions.

## Usage and acceptance

```bash
playwright-cli -s=ui open --config=/usr/local/share/playwright-cli/config.json
playwright-cli -s=ui goto <url>
playwright-cli -s=ui set-color-scheme light
playwright-cli -s=ui screenshot --filename=/tmp/page-light.png
playwright-cli -s=ui set-color-scheme dark
playwright-cli -s=ui screenshot --filename=/tmp/page-dark.png
playwright-cli -s=ui close
```

Use a unique session per concurrent task and close it afterward. Media preference
does not replace application theme controls. Use upstream clicks or scripts for
those controls and the preview-user login flow.

## Isolation and networking

Browser state belongs to the invoking project's private HOME. Verification: in A,
open a session, set a cookie or log in, save a screenshot, and record `id`. From B,
reads of A's physical HOME under `/var/lib/convoy-projects/<a-identity>`, its
workspace marker and its browser files must fail; confirm the marker exists from A
before treating a denial as evidence. A session opened in B must not carry A's
cookie. Test through real agent connections as well as shells.

Browser control uses pipes, not an open debugging port. The application's
localhost port is still shared across projects; file isolation does not protect
credentials served over TCP, so authenticate services holding private data.
In strict network mode, allow the application's outbound hosts and every
asset, auth and redirect domain with `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS`
instead of disabling the firewall. A failed page load alone proves nothing
about the firewall: it can be DNS, TLS or the server. Verify the target from
outside and read the deny counters before claiming enforcement.

## Host browser sessions

Nothing attaches to a human's signed-in browser or copies its cookies. CDP
attachment gives whole-browser control, and Chrome 136+ requires a non-default
profile for remote debugging. Forwarding a debugging port into a VM exposes it
to every project on the shared network, and CDP shares tabs and storage, so
callers are not isolated by tab. A future bridge must authenticate the client,
grant one project access, scope reachable sessions, define revocation and
serialize conflicting actions. A deliberately signed-in automation profile behind
a project-authorized broker is the follow-up; never import a human's whole profile.

Acceptance covers a CLI installed without Playwright, upgrade/rollback without
browser calls, fresh builds of all templates, visible light/dark screenshots,
session shutdown, A/B state isolation, and legacy-volume rebuild behavior.
Record unavailable Docker/VM checks separately from automated test results.

For managed environments built before 0.128.0, first upgrade the host CLI and
rebuild the environment image, then update the container CLI. The old image's
update helper still expects a bundled browser. Rebuild replaces that helper and
stops mounting the legacy cache without deleting its volume.
