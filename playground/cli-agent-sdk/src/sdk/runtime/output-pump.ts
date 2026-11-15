import type { Readable } from "stream";

import { LineParser } from "./line-parser.js";

export interface PumpLineEvent {
  stream: "stdout" | "stderr";
  line: string;
  truncated: boolean;
}

export interface OutputPumpOptions {
  stdout: Readable;
  stderr: Readable;
  maxLineBytesStdout: number;
  maxLineBytesStderr: number;
  maxEventQueueDepth: number;
  onLine: (event: PumpLineEvent) => void | Promise<void>;
  onDrop?: (stream: "stdout" | "stderr") => void;
}

export interface OutputPump {
  done: Promise<void>;
  stop: () => void;
}

export function startOutputPump(options: OutputPumpOptions): OutputPump {
  const stdoutParser = new LineParser(options.maxLineBytesStdout);
  const stderrParser = new LineParser(options.maxLineBytesStderr);

  let stdoutEnded = false;
  let stderrEnded = false;
  let stopped = false;

  const queue: PumpLineEvent[] = [];
  let processing = false;
  let resolveDone: (() => void) | null = null;

  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const maybeResolveDone = () => {
    if (stdoutEnded && stderrEnded && queue.length === 0 && !processing && resolveDone) {
      const doneResolver = resolveDone;
      resolveDone = null;
      doneResolver();
    }
  };

  const processQueue = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) continue;
        await options.onLine(next);
      }
    } finally {
      processing = false;
      maybeResolveDone();
    }
  };

  const pushEvent = (event: PumpLineEvent): void => {
    if (stopped) return;
    if (queue.length >= options.maxEventQueueDepth) {
      options.onDrop?.(event.stream);
      return;
    }
    queue.push(event);
    void processQueue();
  };

  const pushParsed = (stream: "stdout" | "stderr", chunk: Buffer | string): void => {
    const parser = stream === "stdout" ? stdoutParser : stderrParser;
    const parsed = parser.feed(chunk);
    for (const line of parsed) {
      pushEvent({ stream, line: line.line, truncated: line.truncated });
    }
  };

  const onStdoutData = (chunk: Buffer | string) => pushParsed("stdout", chunk);
  const onStderrData = (chunk: Buffer | string) => pushParsed("stderr", chunk);

  const finishStream = (stream: "stdout" | "stderr") => {
    const parser = stream === "stdout" ? stdoutParser : stderrParser;
    for (const line of parser.flush()) {
      pushEvent({ stream, line: line.line, truncated: line.truncated });
    }

    if (stream === "stdout") stdoutEnded = true;
    if (stream === "stderr") stderrEnded = true;
    maybeResolveDone();
  };

  const onStdoutEnd = () => finishStream("stdout");
  const onStderrEnd = () => finishStream("stderr");

  options.stdout.on("data", onStdoutData);
  options.stderr.on("data", onStderrData);
  options.stdout.once("end", onStdoutEnd);
  options.stderr.once("end", onStderrEnd);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    options.stdout.off("data", onStdoutData);
    options.stderr.off("data", onStderrData);
    options.stdout.off("end", onStdoutEnd);
    options.stderr.off("end", onStderrEnd);
    stdoutEnded = true;
    stderrEnded = true;
    maybeResolveDone();
  };

  return { done, stop };
}
