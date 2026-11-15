import { EventEmitter } from "events";
import { PassThrough } from "stream";

import type { ChildProcess } from "child_process";

export interface FakeChildProcess extends ChildProcess {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
}

export function createFakeChildProcess(pid = 9999): FakeChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  const child = Object.assign(emitter, {
    pid,
    stdout,
    stderr,
    stdin,
    kill: (signal?: NodeJS.Signals | number) => {
      queueMicrotask(() => {
        const normalized =
          typeof signal === "string" ? signal : signal === 9 ? "SIGKILL" : "SIGTERM";
        stdout.end();
        stderr.end();
        child.emit("exit", null, normalized);
      });
      return true;
    },
  }) as FakeChildProcess;

  return child;
}

export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}
