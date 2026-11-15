/** The primary way to connect: the CLI walks through login and profile setup. */
export const INTERACTIVE_CONNECT_COMMAND = "npx @useconvoy/cli connect";

interface BuildSetupCommandsArgs {
  convexUrl: string;
  projectId?: string;
  projectName?: string;
  projectAlias?: string;
}

interface SetupCommands {
  profileName: string;
  profileKey: string;
  interactiveSetupCommand: string;
  connectCommand: string;
}

function toSuggestedProfileKey(value?: string): string {
  const fallback = "default";
  const normalized = (value ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safe = normalized || fallback;
  return /^[a-z]/.test(safe) ? safe : `profile-${safe}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildNoProfileSetupCommands(
  args: BuildSetupCommandsArgs
): SetupCommands {
  const projectId = args.projectId ?? "<project_id>";
  const profileName = args.projectName ?? args.projectAlias ?? "default";
  const profileKey = toSuggestedProfileKey(args.projectAlias ?? args.projectName);
  const sharedSetupArgs = [
    "--project",
    projectId,
    "--profile",
    shellQuote(profileName),
    "--profile-key",
    profileKey,
  ];
  const interactiveSetupCommand = [
    "npx",
    "@useconvoy/cli",
    "setup",
    ...sharedSetupArgs,
    "--url",
    args.convexUrl,
  ].join(" ");

  return {
    profileName,
    profileKey,
    interactiveSetupCommand,
    connectCommand: `${INTERACTIVE_CONNECT_COMMAND} --profile ${profileKey}`,
  };
}
