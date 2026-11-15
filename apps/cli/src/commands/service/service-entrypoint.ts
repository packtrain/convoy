import { CredentialStore } from "../../lib/config/credentials/store.js";
import { mutateCredentials } from "../../lib/config/credentials/resolution.js";
import { exitAfterFlush } from "../../lib/connect-events.js";
import { ServiceStartupError, ServiceUnavailableError, startupFailure } from "./errors.js";
import { readConfig } from "../../lib/config/toml.js";
import { inspectProjectEnvironment, inspectProjectEnvironmentAsync, isProjectEnvironment } from "../project/launcher.js";
import { environmentMode } from "../environment/resolution.js";
import { acquireLock, LockHeldError, servicePaths } from "./paths.js";
import { serviceRequest } from "./client.js";
import { serviceSnapshot, sharedServiceSnapshot } from "./resolution.js";
import { saveProjectRegistration, projectRemoval, unregisterProject } from "../project/workflow.js";
import { runService } from "./workflow.js";
import type { ServiceManagement } from "./validators.js";

// Closing a readiness reader must not own the daemon lifetime.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const RUNNING = "Service already running. Use convoy service status.";

async function main() {
  if (!process.getuid?.()) throw new ServiceStartupError("Run the service as your own account, not root.");
  const paths = servicePaths();
  let release: () => void;
  try { release = acquireLock(paths.lock, "service"); }
  catch (error) { throw error instanceof LockHeldError ? new ServiceStartupError(RUNNING) : error; }
  // A service from an older CLI holds a kernel flock instead of this lock, but its socket still answers.
  if (await serviceRequest(paths.socket, { op: "status" }).then(() => true, (error: unknown) => !(error instanceof ServiceUnavailableError))) {
    throw new ServiceStartupError(RUNNING);
  }
  let snapshot, management: ServiceManagement;
  if (environmentMode() === "shared") {
    snapshot = sharedServiceSnapshot(readConfig(), new CredentialStore().read());
    management = { mode: "shared", snapshot: () => sharedServiceSnapshot(readConfig(), new CredentialStore().read()),
      credentials: async (request, accounted) => mutateCredentials(request, "shared", undefined, accounted),
      register: (registration) => saveProjectRegistration(registration, "shared"), removal: projectRemoval, remove: unregisterProject };
  } else {
    if (!isProjectEnvironment()) throw new ServiceStartupError("This environment is isolated, but the project launcher registry is missing. Reinstall the launcher; isolated projects never run unsandboxed.");
    snapshot = serviceSnapshot(readConfig(), inspectProjectEnvironment(), new CredentialStore().read());
    management = { mode: "isolated",
      snapshot: async () => { const environment = await inspectProjectEnvironmentAsync(); return serviceSnapshot(readConfig(), environment, new CredentialStore().read()); },
      credentials: async (request, accounted) => mutateCredentials(request, await inspectProjectEnvironmentAsync(), undefined, accounted),
      register: async (registration) => saveProjectRegistration(registration, await inspectProjectEnvironmentAsync()), removal: projectRemoval, remove: unregisterProject,
    };
  }
  const service = await runService(paths, snapshot, undefined, undefined, undefined, management);
  process.stdout.write("ready\n");
  await service.done;
  await service.close();
  release();
}
main().catch((error: unknown) => {
  process.stdout.write(JSON.stringify({ error: startupFailure(error) }) + "\n");
  exitAfterFlush(1);
});
