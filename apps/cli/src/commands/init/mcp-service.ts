import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { api } from "../../convex/_generated/api.js";
import { createConvexClient } from "../../lib/config/index.js";
import { buildMcpUrl } from "../../lib/url.js";
import { InitError } from "./errors.js";
import { getInitDrivers } from "./targets/registry.js";
import { DEFAULT_MCP_TARGETS, INIT_TARGETS, type InitMcpConfig, type InitTarget } from "./types.js";

async function resolveProjectMcpUrl(config: {
  convexUrl: string;
  apiKey: string;
  projectId: string;
}): Promise<string> {
  const spinner = ora("Fetching project info...").start();
  const client = createConvexClient({
    url: config.convexUrl,
    apiKey: config.apiKey,
  });

  let orgSlug: string;
  let projectAlias: string;

  try {
    const projects = await client.query(api.projects.core.listAccessible, {});
    const project = projects.find(
      (item: { _id: string }) => item._id === config.projectId
    );

    if (!project) {
      spinner.fail("Project not found");
      throw new InitError(
        `Project ${config.projectId} not found or not accessible with this API key.`
      );
    }

    orgSlug = project.organizationSlug;
    projectAlias = project.alias;
    spinner.succeed(
      `Project: ${chalk.cyan(`${orgSlug}/${projectAlias}`)} (${project.name})`
    );
  } finally {
    await client.close();
  }

  return buildMcpUrl(config.convexUrl, orgSlug, projectAlias);
}

export async function runInitMcp(config: InitMcpConfig): Promise<void> {
  const baseDir = path.resolve(config.outputDir ?? process.cwd());
  const targets: ReadonlyArray<InitTarget> = config.cliTargets ?? DEFAULT_MCP_TARGETS;

  if (targets.length === 0) {
    throw new InitError(
      `No MCP targets selected. Choose one of: ${INIT_TARGETS.join(", ")}`
    );
  }

  const mcpUrl = await resolveProjectMcpUrl({
    convexUrl: config.convexUrl,
    apiKey: config.apiKey,
    projectId: config.projectId,
  });

  const drivers = getInitDrivers(targets);
  const logger = {
    info(message: string): void {
      console.log(message);
    },
    warn(message: string): void {
      console.warn(message);
    },
  };

  for (const driver of drivers) {
    await driver.configureMcp({
      baseDir,
      mcpUrl,
      apiKey: config.apiKey,
      force: config.force,
      confirmOverwrite: (message: string) => confirm({ message, default: true }),
      log: logger,
    });
  }
}
