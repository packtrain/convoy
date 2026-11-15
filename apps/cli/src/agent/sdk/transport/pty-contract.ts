import type { ChildProcess } from "child_process";

import type { SpawnSpec } from "../types.js";

export interface PtyProcessHandle {
  readonly pid: number;
  child: ChildProcess;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
}

export interface PtyRuntime {
  spawn(spec: SpawnSpec): Promise<PtyProcessHandle>;
}
