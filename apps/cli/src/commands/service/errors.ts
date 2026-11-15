/** Only intentional, credential-free diagnostics cross the startup channel. */
export class ServiceStartupError extends Error {}

export function startupFailure(error: unknown): string {
  return error instanceof ServiceStartupError ? error.message :
    "Service startup failed. Check project list, config.toml, launcher setup and private HOME permissions.";
}

export class ServiceUnavailableError extends Error {}

/** Only exact, intentional backend diagnostics may use this error. */
export class ServiceOperationError extends Error {}

export class ServiceCompatibilityError extends Error {
  override name = "ServiceCompatibilityError";
}

export class ServiceRejectedError extends Error {
  override name = "ServiceRejectedError";
}

/** A transport diagnostic, such as an SSH failure, that clients show verbatim. */
export class ServiceTransportError extends Error {}
