import { render } from "ink";
import { App } from "./app.js";
import type { Connection } from "./resolution.js";
import { Browser } from "./workflow.js";

export async function run(targets: Connection[], selected = 0, localPackage?: string) {
  let handoff: { operation: (signal: AbortSignal) => Promise<void>; resolve(): void; reject(error: unknown): void } | undefined;
  let stopped = false;
  const abort = new AbortController();
  // Alternate screen: no scrollback while the TUI runs; leaving restores the shell screen.
  let alternate = false;
  const enterScreen = () => { if (!alternate) process.stdout.write("\u001b[?1049h\u001b[H"); alternate = true; };
  const leaveScreen = () => { if (alternate) process.stdout.write("\u001b[?1049l"); alternate = false; };
  const browser = new Browser(targets, selected, operation => new Promise((resolve, reject) => {
    handoff = { operation, resolve, reject };
    instance.unmount();
  }));
  browser.localPackage = localPackage;
  const mount = () => { enterScreen(); return render(<App browser={browser} />, { exitOnCtrlC: false, patchConsole: false }); };
  let instance = mount();
  const stop = () => { stopped = true; abort.abort(); browser.dispose(); instance.unmount(); };
  const interrupt = () => { if (!handoff) stop(); };
  process.on("SIGINT", interrupt);
  process.on("exit", leaveScreen);
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
  try {
    browser.start();
    while (!stopped) {
      await instance.waitUntilExit();
      instance.cleanup();
      leaveScreen();
      const pending = handoff;
      if (!pending || stopped) break;
      // Finish deferred stdin listener cleanup before stopping its reader.
      await new Promise<void>(resolve => setImmediate(resolve));
      process.stdin.setRawMode(false);
      process.stdin.pause();
      try { abort.signal.throwIfAborted(); await pending.operation(abort.signal); pending.resolve(); }
      catch (error) { pending.reject(error); }
      finally {
        handoff = undefined;
        if (!stopped) instance = mount();
      }
    }
  } finally {
    browser.dispose(); instance.unmount(); instance.cleanup();
    leaveScreen(); process.off("exit", leaveScreen);
    if (browser.environmentBusy) process.stderr.write("Finishing the environment operation before exit…\n");
    process.off("SIGINT", interrupt);
    for (const signal of ["SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
  }
}
