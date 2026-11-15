/**
 * Per-environment UI differentiation: non-production environments show a small colored
 * card in the sidebar footer.
 *
 * To add one: extend `AppEnvironment`, add an `ENVIRONMENT_CONFIGS` entry, and set
 * `NEXT_PUBLIC_APP_ENV` in the deployment.
 */

export type AppEnvironment = "dev" | "staging" | "production";

interface EnvironmentConfig {
  /** Display label for the environment card */
  label: string;
  /** Short description shown in the card */
  description: string;
  /** Whether to show the environment card in the sidebar */
  showCard: boolean;
  /** Tailwind classes for the card container */
  cardClassName: string;
  /** Tailwind classes for the card title */
  titleClassName: string;
  /** Tailwind classes for the card description */
  descriptionClassName: string;
}

const ENVIRONMENT_CONFIGS: Record<AppEnvironment, EnvironmentConfig> = {
  dev: {
    label: "Development",
    description: "You are on the dev environment",
    showCard: true,
    cardClassName:
      "bg-warning-soft border-warning/30",
    titleClassName: "text-warning-foreground",
    descriptionClassName: "text-warning",
  },
  staging: {
    label: "Staging",
    description: "You are on the staging environment",
    showCard: true,
    cardClassName:
      "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800/50",
    titleClassName: "text-indigo-900 dark:text-indigo-300",
    descriptionClassName: "text-indigo-700 dark:text-indigo-400/80",
  },
  production: {
    label: "Production",
    description: "",
    showCard: false,
    cardClassName: "",
    titleClassName: "",
    descriptionClassName: "",
  },
};

function resolveEnvironment(): AppEnvironment {
  const raw = process.env.NEXT_PUBLIC_APP_ENV;
  if (raw === "dev" || raw === "staging" || raw === "production") {
    return raw;
  }
  return "production";
}

export const APP_ENVIRONMENT: AppEnvironment = resolveEnvironment();

export function getEnvironmentConfig(): EnvironmentConfig {
  return ENVIRONMENT_CONFIGS[APP_ENVIRONMENT];
}
