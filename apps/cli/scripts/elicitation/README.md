# MCP elicitation test server

A dependency-free Node.js stdio fixture for OS-1972. Claude starts and stops it;
there is no listening port or separate server to run. It writes no files and
accesses no accounts. Test answers are echoed into the thread, so use made-up
values.

## Connect to the dev thread

Run this **on the machine or container running your dev Convoy CLI**, from the
same repo directory selected as the thread's workspace:

```bash
claude mcp add --transport stdio --scope local elicitation-test -- node "$PWD/apps/cli/scripts/elicitation/server.mjs"
```

If that workspace is a different directory, replace the script argument with its
absolute path on that machine. The script needs Node.js, but no pnpm install or
build. Local scope keeps this registration specific to that workspace and does
not write a tracked `.mcp.json`.

Use the updated dev Convoy CLI with the OS-1972 changes. Start a new Claude Code
thread in that workspace after registering. If Claude asks for permission to
use the test tool, allow it. That approval is separate from the elicitation
form. Tool names appear as `mcp__elicitation-test__test_form` and
`mcp__elicitation-test__test_url`.

## Prompts and expected results

**Form.** Run three times, selecting Submit, Decline, and Cancel:

> Call mcp__elicitation-test__test_form once with no arguments. Let me respond to the MCP form. Do not use AskUserQuestion or answer on my behalf. Afterward, report the action and values returned by the tool.

The form has a required nickname, integer count from 1 to 5, a color selection,
and a boolean. Try an empty nickname and count 0 before submitting valid values.
The tool should report `accept` and your typed values, or `decline`/`cancel`.

**URL.** Run three times, selecting Continue, Decline, and Cancel:

> Call mcp__elicitation-test__test_url once with no arguments. Let me use the URL elicitation card. Do not open the URL yourself. Afterward, report the action returned by the tool.

Open in browser should navigate to https://example.com/ only when clicked.
Return to Convoy and select Continue. This checks the URL card and response,
not OAuth or an external completion notification. The fixture cannot detect
whether you opened the page.

**Stop.** Send the form prompt, then click Stop with the form unanswered. The
card should disappear without a failure flash. Send a new prompt afterward to
check that the thread can continue.

**Long wait.** Send the form prompt, leave it unanswered for 11 minutes, then
submit. The fixture has no timeout. A timeout from Claude or its MCP transport
is distinct from Convoy's idle watchdog; capture the error if one occurs.

**Multiple cards.** Optional:

> Call mcp__elicitation-test__test_form twice in parallel. Let me answer the second card first. Do not use AskUserQuestion or supply answers yourself. Report each tool's returned values.

This depends on Claude choosing parallel tool calls. Each request has its own
ID, so different answers should return to their corresponding calls.

## Remove and verify

From the same workspace:

```bash
claude mcp remove --scope local elicitation-test
```

Run the fixture's protocol tests from the Convoy repo root:

```bash
node --test apps/cli/scripts/elicitation/server.test.mjs
```

The tests spawn short-lived stdio subprocesses and cover discovery, capability
checks, form and URL actions, concurrent request correlation, and cancellation.
They do not exercise a live Claude model or the browser.

Protocol reference: [MCP elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).
