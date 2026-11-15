import { environmentExists } from "../environment/paths.js";
import { readRemotes } from "./paths.js";
import type { Remote } from "./validators.js";

let target: Remote | undefined;
/** The `--remote` target of a `keys` command; keys then never touch host storage. */
export function setTargetRemote(remote?: Remote) { target = remote; }
export function targetRemote() { return target; }

/** The option a `--target` name stands for. Spec: docs/specs/cli-remote.md#one-target-flag-cli-01200-os-2215 */
export function targetOption(name: string): "environment" | "remote" {
  const remote = readRemotes().some(value => value.name === name), environment = environmentExists(name);
  if (remote && environment) throw new Error(`${name} is both a managed environment and a remote. Use --env ${name} or --remote ${name}.`);
  if (!remote && !environment) throw new Error(`No environment or remote named ${name}. Create one with convoy run --env ${name} or convoy remote add ${name} --host <ssh-destination>.`);
  return remote ? "remote" : "environment";
}
