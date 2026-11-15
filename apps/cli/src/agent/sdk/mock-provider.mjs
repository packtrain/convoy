#!/usr/bin/env node

import process from "node:process";

function parseArg(name, defaultValue) {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!found) return defaultValue;
  return found.slice(name.length + 3);
}

const mode = parseArg("mode", "json");
const delayMs = Number(parseArg("delayMs", "20"));
const shouldFail = parseArg("fail", "false") === "true";
const keepAlive = parseArg("keepAlive", "false") === "true";

let sequence = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function writeLine(line) {
  process.stdout.write(`${line}\n`);
}

async function emitStartup() {
  if (mode === "json") {
    writeJson({ type: "system", session_id: "mock-session-1", sequence: sequence++ });
    writeJson({ type: "assistant", text: "Mock provider ready", sequence: sequence++ });
    return;
  }

  writeLine("Mock provider ready");
}

async function emitResult(text) {
  if (mode === "json") {
    writeJson({ type: "assistant", text: `Echo: ${text}`, sequence: sequence++ });
    writeJson({
      type: shouldFail ? "error" : "result",
      result: shouldFail ? undefined : `done:${text}`,
      error: shouldFail ? "mock failure" : undefined,
      sequence: sequence++,
    });
    return;
  }

  writeLine(`Echo: ${text}`);
  writeLine(shouldFail ? "ERROR: mock failure" : `RESULT: done:${text}`);
}

async function main() {
  await emitStartup();

  let buffered = "";
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", async (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (text.toLowerCase() === "exit") {
        process.exit(0);
      }

      await sleep(delayMs);
      await emitResult(text);

      if (shouldFail) {
        process.exit(1);
      }

      if (!keepAlive) {
        process.exit(0);
      }
    }
  });
}

void main();
