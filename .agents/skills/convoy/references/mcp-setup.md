# Convoy MCP Setup Guide

## Overview

Convoy exposes a JSON-RPC 2.0 MCP endpoint at `/api/mcp` on its Convex deployment. Authentication uses user-scoped API keys passed as Bearer tokens.

## Quickest Path: the CLI

If the `convoy` CLI is installed, skip the manual steps below:

```bash
convoy login      # browser-approved auth + project selection
convoy init mcp   # writes the MCP config for detected CLI targets
```

`convoy init mcp` needs a configured profile (from `convoy login` or `convoy setup`), or explicit `--url`, `--api-key`, and `--project` flags. The manual steps below cover any MCP client.

## Step 1: Create an API Key

1. Log in to Convoy web UI
2. Navigate to **Settings > API Keys**
3. Click **Create API Key**
4. Set a descriptive name (e.g., "Claude Code MCP")
5. Set an expiration date (maximum 1 year)
6. Copy the key immediately — it is shown only once

### API Key Details

- Format: `sk_user_{32 random base64 characters}`
- Scope: User-level — grants access to all projects the user can access
- Maximum: 10 active keys per user
- Storage: Keys are SHA-256 hashed server-side (not recoverable)
- Tracking: `lastUsedAt` timestamp recorded on each use

## Step 2: Configure MCP Client

### Claude Code (project-scoped — recommended)

Scope the MCP connection to a specific Convoy project by adding `?project=` to the URL. This way all tools automatically use that project — no need to pass `projectId` on every call.

The `?project=` parameter accepts two formats:

- **`org-slug/ALIAS`** (recommended) — uses the same org slug and project alias from your web UI URL (e.g., `acme/WEB` from `/o/acme/WEB/...`)
- **Convex document ID** — the raw project ID (e.g., from `list_projects`)

Create or edit `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://<YOUR_DEPLOYMENT>.convex.site/api/mcp?project=<ORG_SLUG>/<PROJECT_ALIAS>",
      "headers": {
        "Authorization": "Bearer sk_user_<YOUR_API_KEY>"
      }
    }
  }
}
```

Replace `<ORG_SLUG>` with your organization slug and `<PROJECT_ALIAS>` with the project alias (e.g., `acme/WEB`).

### Claude Code (global — multi-project)

Edit `~/.claude/mcp.json` to make Convoy available in all projects without scoping to a specific project. You'll need to pass `projectId` to each tool call, or call `list_projects` first to discover project IDs:

```json
{
  "mcpServers": {
    "convoy": {
      "type": "http",
      "url": "https://<YOUR_DEPLOYMENT>.convex.site/api/mcp",
      "headers": {
        "Authorization": "Bearer sk_user_<YOUR_API_KEY>"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can connect. The endpoint accepts standard JSON-RPC 2.0 over HTTP POST:

- **URL**: `https://<DEPLOYMENT>.convex.site/api/mcp` (append `?project=<ID>` for project-scoped access)
- **Method**: POST
- **Headers**: `Authorization: Bearer sk_user_...`, `Content-Type: application/json`
- **CORS**: Supported (OPTIONS preflight handled)

## Step 3: Verify Connection

After configuring, verify by calling `list_projects`. If it returns project data, the connection is working.

Manual verification with curl:

```bash
CONVEX_URL="https://<YOUR_DEPLOYMENT>.convex.site"
API_KEY="sk_user_<YOUR_KEY>"

# Test initialize (handshake)
curl -X POST "$CONVEX_URL/api/mcp" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Test listing tools
curl -X POST "$CONVEX_URL/api/mcp" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Test listing projects
curl -X POST "$CONVEX_URL/api/mcp" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_projects"}}'
```

## API Key Management

### Revoking a Key

Navigate to **Settings > API Keys** and click **Revoke** on the target key. Revocation is immediate — all MCP connections using that key will start receiving 401 errors.

### Rotating a Key

1. Create a new API key
2. Update MCP configuration with the new key
3. Verify the new key works
4. Revoke the old key

### Security Best Practices

- Use separate API keys for different machines/contexts
- Set the shortest practical expiration
- Revoke keys immediately when no longer needed
- Never commit API keys to version control — use environment variables or `.mcp.json` in `.gitignore`
- The `.mcp.json` file may contain secrets; ensure it is gitignored

## Troubleshooting

### 401 Unauthorized

- Verify the API key is correct and not expired
- Confirm the `Authorization` header includes the `Bearer ` prefix (with space)
- Check that the key has not been revoked in Settings > API Keys

### 403 Forbidden

- The API key's user does not have access to the requested project
- Verify project membership in the Convoy web UI
- Org owners/admins have implicit access to all org projects

### Connection Refused / Timeout

- Verify the Convex deployment URL is correct
- Check that the URL ends with `/api/mcp` (not just `/api/`)
- Ensure network connectivity to the Convex deployment

### Empty Project List

- The API key user may not be a member of any organization or project
- Check organization and project memberships in the web UI

### Tool Not Found

- Verify the MCP config `url` field points to the correct endpoint
- Run `tools/list` to see all available tools
- Tool names are case-sensitive: `list_projects`, not `listProjects`

### Stale Data

- MCP queries reflect real-time data from Convex
- If data seems stale, verify the correct deployment URL (dev vs production)
