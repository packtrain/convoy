# Manual Test Cases: `convoy init`

Prerequisites for all tests:
- Build the CLI: `pnpm --filter @useconvoy/cli build`
- Have at least one profile configured: `convoy setup`
- Have Claude Code CLI installed: `claude --version`

Run CLI in dev mode with: `pnpm --filter @useconvoy/cli dev -- init ...`
Or after building: `node apps/cli/dist/bin/convoy.js init ...`

---

## 1. `convoy init mcp` — Happy Path (default targets = both)

**Setup:** Have a valid profile configured (via `convoy setup`).

```bash
convoy init mcp
```

**Expected:**
- Spinner: "Fetching project info..."
- Success: `Project: <org-slug>/<ALIAS> (<project name>)`
- Creates `.mcp.json` and `.codex/config.toml` in cwd
- Output includes:
  - `✓ Created <path>/.mcp.json`
  - `✓ Created <path>/.codex/config.toml`
- If `.mcp.json` not in `.gitignore`: warning with `echo '.mcp.json' >> .gitignore`
- If `.codex/config.toml` not in `.gitignore`: warning with `echo '.codex/config.toml' >> .gitignore`

**Verify:**
```bash
cat .mcp.json
```
Should contain convoy server entry:
```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://<deployment>.convex.site/api/mcp?project=<org-slug>/<ALIAS>",
      "headers": {
        "Authorization": "Bearer sk_user_..."
      }
    }
  }
}
```

And:
```bash
cat .codex/config.toml
```
Should contain:
```toml
[mcp_servers.convoy]
url = "https://<deployment>.convex.site/api/mcp?project=<org-slug>/<ALIAS>"
http_headers = { Authorization = "Bearer sk_user_..." }
```

---

## 2. `convoy init mcp` — Output Directory

```bash
mkdir -p /tmp/test-init
convoy init mcp --output-dir /tmp/test-init
```

**Expected:**
- `.mcp.json` created at `/tmp/test-init/.mcp.json` (not cwd)
- `.codex/config.toml` created at `/tmp/test-init/.codex/config.toml` (not cwd)

**Cleanup:** `rm -rf /tmp/test-init`

---

## 3. `convoy init mcp --cli claude` — Claude-only output

```bash
convoy init mcp --cli claude --force
```

**Expected:**
- `.mcp.json` written/updated
- `.codex/config.toml` is not created

---

## 4. `convoy init mcp --cli codex` — Codex-only output

```bash
convoy init mcp --cli codex --force
```

**Expected:**
- `.codex/config.toml` written/updated
- `.mcp.json` is not created

---

## 5. `convoy init mcp` — Merge with Existing Config

**Setup:** Create a `.mcp.json` with another server already in it.

```bash
echo '{"mcpServers":{"other-tool":{"type":"url","url":"https://example.com","headers":{}}}}' > .mcp.json
convoy init mcp --force
```

**Expected:**
- `.mcp.json` now has both `other-tool` AND `convoy` keys
- Output says "Created" (not "Updated" since convoy key was new)

**Verify:**
```bash
cat .mcp.json | python3 -m json.tool
```
Should show both servers.

---

## 6. `convoy init mcp` — Overwrite Prompt

**Setup:** Run `convoy init mcp` twice.

```bash
convoy init mcp --force    # First run
convoy init mcp            # Second run (no --force)
```

**Expected on second run:**
- Prompt for each existing target file, e.g.:
  - `Existing convoy MCP config found in .mcp.json. Overwrite?`
  - `Existing convoy MCP config found in .codex/config.toml. Overwrite?`
- If you answer **No**: file unchanged, output "Cancelled."
- If you answer **Yes**: file updated, output says "Updated"

---

## 7. `convoy init mcp --force` — Skip Prompt

```bash
convoy init mcp --force    # First run
convoy init mcp --force    # Second run
```

**Expected:** No prompt on second run. File updated silently.

---

## 8. `convoy init mcp` — No Profile Configured

**Setup:** Run from a directory with no matching profile and no default.

```bash
cd /tmp
convoy init mcp
```

**Expected:**
- Error: "Missing required configuration:"
- Lists missing items (Convex URL, API Key, Project ID)
- Hint: "Run 'convoy setup' first, or pass --url, --api-key, --project."
- Exit code 1

---

## 9. `convoy init mcp` — With Explicit Profile

```bash
convoy init mcp --profile my-profile
```

**Expected:** Uses the specified profile's credentials, not path-based auto-detection.

---

## 10. `convoy init mcp` — Malformed Existing .mcp.json

**Setup:**
```bash
echo "not valid json" > .mcp.json
convoy init mcp
```

**Expected:** Error about failing to parse `.mcp.json`. Exit code 1.

**Cleanup:** `rm .mcp.json`

---

## 11. `convoy init mcp` — Invalid Existing .mcp.json Structure

**Setup:**
```bash
echo '{"servers":{}}' > .mcp.json
convoy init mcp
```

**Expected:** Error: `Invalid .mcp.json: expected an object with "mcpServers" key.`

**Cleanup:** `rm .mcp.json`

---

## 12. `convoy init mcp` — Malformed Existing .codex/config.toml

**Setup:**
```bash
mkdir -p .codex
echo "not valid toml = =" > .codex/config.toml
convoy init mcp --cli codex
```

**Expected:** Error about failing to parse `.codex/config.toml`. Exit code 1.

---

## 13. `convoy init skill` — Happy Path (Interactive)

```bash
convoy init skill
```

**Expected:**
- Spinner: "Checking for Claude Code CLI..."
- Success: "Claude Code CLI found"
- Interactive prompt: "Where should skills be installed?"
  - Project
  - User
- Choose one
- Spinner: "Installing Convoy skill..."
- Success: "Convoy skill installed"
- Shows scope and source path

---

## 14. `convoy init skill --scope user`

```bash
convoy init skill --scope user
```

**Expected:**
- No scope prompt (skipped)
- Installs to `~/.claude/settings.json`
- Success output

---

## 15. `convoy init skill --scope project`

```bash
convoy init skill --scope project
```

**Expected:**
- No scope prompt
- Installs to `.claude/settings.json` in cwd

---

## 16. `convoy init skill` — Invalid Scope

```bash
convoy init skill --scope invalid
```

**Expected:**
- Error: `Invalid scope "invalid". Must be one of: project, user`
- Exit code 1

---

## 17. `convoy init skill` — Claude Code Not Installed

**Setup:** Temporarily rename the claude binary or use a clean PATH.

```bash
PATH=/usr/bin:/bin convoy init skill --scope user
```

**Expected:**
- Spinner: "Checking for Claude Code CLI..."
- Fail: "Claude Code CLI not found"
- Error: "The 'claude' command is not available."
- Install link shown
- Exit code 1

---

## 18. `convoy init` — Full Init (Both Steps)

```bash
rm -f .mcp.json
rm -rf .codex
convoy init --force --scope project
```

**Expected output flow:**
```
Convoy Init

Step 1: MCP Configuration

  ⠋ Fetching project info...
  ✓ Project: acme/WEB (My Project)
  ✓ Created /path/to/.mcp.json

  ⚠ .mcp.json contains API keys. Add it to .gitignore:
    echo '.mcp.json' >> .gitignore

Step 2: Claude Code Skill

  ✓ Claude Code CLI found
  ✓ Convoy skill installed
  Scope: local
  Source: /path/to/marketplace

✓ Initialization complete.
```

---

## 17. `convoy init` — No Profile, Skill Still Runs

**Setup:** Run from a directory with no matching profile.

```bash
cd /tmp
convoy init --scope user
```

**Expected:**
- Step 1 prints: "Skipping MCP setup (no profile configured)."
- Hint: "Run 'convoy setup' first, then 'convoy init mcp'."
- Step 2 still runs and installs the skill
- "Initialization complete."

---

## 18. `convoy init` — Help Text

```bash
convoy init --help
```

**Expected:**
```
Usage: convoy init [options] [command]

Initialize Convoy integrations (MCP config + Claude Code skill)

Options:
  -o, --output-dir <path>  Directory to write .mcp.json (default: cwd)
  -f, --force              Overwrite existing config without prompting
  -s, --scope <scope>      Skill installation scope (prompts if omitted)
  -h, --help               display help for command

Commands:
  mcp                      Create/update .mcp.json with Convoy MCP server configuration
  skill                    Install the Convoy skill for Claude Code
```

---

## 19. Subcommand Help

```bash
convoy init mcp --help
convoy init skill --help
```

**Expected:** Each shows its own options.

---

## 20. Gitignore Detection

**Test A — .mcp.json in .gitignore:**
```bash
echo '.mcp.json' >> .gitignore
convoy init mcp --force
```
**Expected:** No gitignore warning.

**Test B — .mcp.json NOT in .gitignore:**
```bash
# Remove .mcp.json from .gitignore first
convoy init mcp --force
```
**Expected:** Warning shown: "⚠ .mcp.json contains API keys. Add it to .gitignore:"

---

## 21. Build Includes Marketplace

```bash
pnpm --filter @useconvoy/cli build
ls apps/cli/dist/marketplace/.claude-plugin/marketplace.json
ls apps/cli/dist/marketplace/convoy/.claude-plugin/plugin.json
```

**Expected:** Both files exist — marketplace and plugin were copied during build.

---

## Cleanup

After testing, remove any test artifacts:
```bash
rm -f .mcp.json
rm -rf /tmp/test-init
```
