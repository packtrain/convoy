# Publishing the CLI

The CLI ships to npm as [`@useconvoy/cli`](https://www.npmjs.com/package/@useconvoy/cli)
and installs the `convoy` binary. Publishing is automated by
[`.github/workflows/publish-cli.yml`](../../.github/workflows/publish-cli.yml).

Until that workflow is live, publish manually from `apps/cli/`:
`npm run release` (logs out, web-flow login, then `npm publish`; the build runs
via `prepack`).

## How a release happens

1. Bump `version` in `apps/cli/package.json` (minor for features, patch for
   fixes — required in every change touching `apps/cli` anyway).
2. Merge to `main`.

The workflow runs on every push to `main`, but the first step asks npm whether
`@useconvoy/cli@<version>` already exists. If it does, the job stops there and
nothing is published. If it does not, the workflow lints, tests, builds
(`prepack`), and publishes.

The version check is the gate — there is no separate release trigger and no tag
to push.

## One-time npm setup

When releasing the project-isolation template, update `CONVOY_VERSION` in
`templates/project-isolation/devcontainer.json` to match `apps/cli/package.json`.
Keep the CLI, bundled launcher and downloaded template compatible. Test the
packed package and rerun the root launcher installer on the acceptance VM;
updating npm alone does not replace the installed helper. Publish the package
before advertising its pinned template version as available.

The package uses **trusted publishing** (OIDC), so there is no npm token in
GitHub secrets.

1. Publish `0.48.0` once manually from `apps/cli/` (`npm publish`) — a trusted
   publisher can only be configured on a package that already exists.
   With 2FA enabled, authenticate through the web flow first (`npm logout && npm
   login`; npm 9+ defaults to `--auth-type=web`) so the passkey/security-key
   challenge is attached — a `legacy` login gets a 403 at publish time. If a
   one-time password is still prompted for and the only second factor is a
   passkey, use a single-use account recovery code.
2. On npmjs.com: package → Settings → **Trusted Publisher** → GitHub Actions:
   - Organization or user: `packtrain`
   - Repository: `convoy`
   - Workflow filename: `publish-cli.yml`
   - Allowed actions: `npm publish`
3. Harden afterwards: set the package's Publishing access to **Require
   two-factor authentication and disallow tokens** (this does not affect OIDC),
   and revoke any unused automation tokens.

Fields are case-sensitive and npm does not validate them on save — a typo only
surfaces as a publish failure. `repository.url` in `package.json` must match the
GitHub repo exactly.

Provenance attestations are generated automatically under OIDC; no
`--provenance` flag is needed.

Do not fall back to a granular access token with "bypass 2FA" for publishing:
npm is phasing those out (management operations since early August 2026, direct
publish around January 2027), leaving them scoped to reading private packages and
staging a publish that a human then approves.

## Deploying a build to a remote

To test unpublished CLI code on the acceptance VM, save it as a remote
(`convoy remote add vm --host <destination>`), then run from the repository root:

```bash
pnpm cli:deploy vm             # build, pack, install, restart
pnpm cli:deploy vm --launcher  # also rerun install.py after launcher changes
```

From `apps/cli`, use `pnpm run deploy vm [--launcher]`. Plain `pnpm deploy` is pnpm's
own command.

[`apps/cli/scripts/deploy.ts`](../../apps/cli/scripts/deploy.ts) builds and packs
`apps/cli`, then:

1. uploads the tarball over SSH into a private `mktemp -d` folder on the host
2. runs `service stop`, and goes on if no service was running
3. runs `sudo npm install --prefix /opt/convoy <tarball>` over `ssh -t`, so sudo can
   prompt, then removes the folder
4. with `--launcher`, reruns `install.py` as root with the control account,
   workspace, package root, Node and state from `/etc/convoy-projects.json`
5. runs `service start -b`, then prints the remote `convoy --version` and
   `service status`

If the install fails, the service stays stopped. Remotes with `--container` are
refused; rebuild that environment with `convoy env rebuild --package` instead.
The script is not part of the published package.

## Browser tooling

The CLI has no Playwright dependency. Browser tooling belongs to container images
and changes only on image rebuild. Repository application tests retain their own
Playwright version. See [Browser automation](../specs/cli-browser-automation.md).
