import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { resolveMachineId, selectMachines } from "./machine.js";
import type { ContextSnapshot } from "../context-env.js";
import { renderBorderlessTable } from "../table.js";
import {
  collectOption,
  confirmDestructiveAction,
  outputJson,
  type JsonOutputOptions,
} from "./helpers.js";

interface SkillWorkspaceOptions extends JsonOutputOptions {
  environment?: string;
  project?: string;
}

interface SkillDeleteOptions extends SkillWorkspaceOptions {
  yes?: boolean;
}

interface SkillUpdateOptions extends SkillWorkspaceOptions {
  file: string;
  revision: string;
}

interface SkillInstallCliSkillsOptions extends JsonOutputOptions {
  machine: string[];
}

function projectId(
  options: SkillWorkspaceOptions,
  context: ContextSnapshot,
): string {
  return options.project ?? context.projectId ?? PERSONAL_PROJECT_ID;
}

function environmentId(options: SkillWorkspaceOptions): string | null {
  return options.environment ?? null;
}

function addWorkspaceOptions(command: Command): Command {
  return command
    .option(
      "--project <id>",
      "Project ID (defaults to BB_PROJECT_ID or personal)",
    )
    .option("--environment <id>", "Project environment workspace")
    .option("--json", "Print machine-readable JSON output");
}

export function registerSkillCommands(
  program: Command,
  getUrl: () => string,
  getContext: () => ContextSnapshot,
): void {
  const skill = program
    .command("skill")
    .description("List, inspect, edit, and remove skills");

  addWorkspaceOptions(skill.command("list"))
    .description("List installed and discovered skills")
    .action(
      action(async (options: SkillWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.list({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
        });
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["ID", "NAME", "SCOPE", "PROVIDER", "EDITABLE", "PATH"],
              colWidths: [72, 24, 18, 14, 10, 48],
              trimTrailingWhitespace: true,
            },
            result.skills.map((entry) => [
              entry.id,
              entry.name,
              entry.scope,
              entry.provider ?? "bb",
              entry.manageable ? "yes" : "no",
              entry.filePath,
            ]),
          ),
        );
      }),
    );

  addWorkspaceOptions(skill.command("show <skill-id>"))
    .description("Print an installed skill file")
    .option("--path <path>", "Skill-relative file path", "SKILL.md")
    .action(
      action(
        async (
          skillId: string,
          options: SkillWorkspaceOptions & { path: string },
        ) => {
          const result = await createCliBbSdk(getUrl()).skills.getContent({
            projectId: projectId(options, getContext()),
            environmentId: environmentId(options),
            skillId,
            path: options.path,
          });
          if (outputJson(options, result)) return;
          console.error(`Revision: ${result.revision}`);
          process.stdout.write(result.content);
        },
      ),
    );

  addWorkspaceOptions(skill.command("files <skill-id>"))
    .description("List files included in an installed skill")
    .action(
      action(async (skillId: string, options: SkillWorkspaceOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.listFiles({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
        });
        if (outputJson(options, result)) return;
        for (const path of result.files) console.log(path);
        if (result.truncated) console.error("File list truncated.");
      }),
    );

  addWorkspaceOptions(skill.command("update <skill-id>"))
    .description("Replace an editable skill's SKILL.md from a local file")
    .requiredOption("--file <path>", "Local SKILL.md to upload")
    .requiredOption(
      "--revision <sha256>",
      "Revision returned by bb skill show --json",
    )
    .action(
      action(async (skillId: string, options: SkillUpdateOptions) => {
        const result = await createCliBbSdk(getUrl()).skills.update({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
          content: await readFile(options.file, "utf8"),
          revision: options.revision,
        });
        if (outputJson(options, result)) return;
        console.log(`Updated ${result.filePath}`);
      }),
    );

  addWorkspaceOptions(skill.command("delete <skill-id>"))
    .description("Delete an editable user-owned skill")
    .option("--yes", "Skip the confirmation prompt")
    .action(
      action(async (skillId: string, options: SkillDeleteOptions) => {
        if (
          !options.yes &&
          !(await confirmDestructiveAction(
            `Delete ${skillId}? This cannot be undone.`,
          ))
        ) {
          console.log("Aborted.");
          return;
        }
        const result = await createCliBbSdk(getUrl()).skills.remove({
          projectId: projectId(options, getContext()),
          environmentId: environmentId(options),
          skillId,
        });
        if (outputJson(options, result)) return;
        console.log(`Deleted ${result.deletedPath}`);
      }),
    );

  skill
    .command("cli-skills-status")
    .description(
      "Show whether each machine has bb's built-in CLI skills installed",
    )
    .option(
      "--machine <id-or-name>",
      "Machine to report on (repeatable, defaults to every persistent machine)",
      collectOption,
      [],
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: SkillInstallCliSkillsOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hosts = options.machine.length > 0 ? await sdk.hosts.list() : [];
        const hostIds =
          options.machine.length > 0
            ? options.machine.map((target) => resolveMachineId(hosts, target))
            : undefined;
        const result = await sdk.system.cliSkillsStatus(
          hostIds === undefined ? {} : { hostIds },
        );
        if (outputJson(options, result)) return;
        console.log(
          renderBorderlessTable(
            {
              head: ["MACHINE", "STATUS"],
              colWidths: [32, 16],
              trimTrailingWhitespace: true,
            },
            result.machines.map((machine) => [
              machine.hostName,
              machine.status,
            ]),
          ),
        );
      }),
    );

  skill
    .command("install-cli-skills")
    .description(
      "Install bb's built-in CLI skills into ~/.agents/skills and ~/.claude/skills on a machine",
    )
    .option(
      "--machine <id-or-name>",
      "Machine to install onto (repeatable, defaults to every connected persistent machine)",
      collectOption,
      [],
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: SkillInstallCliSkillsOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const hosts = await sdk.hosts.list();
        const hostIds =
          options.machine.length > 0
            ? options.machine.map((target) => resolveMachineId(hosts, target))
            : selectMachines(hosts, "persistent")
                .filter((host) => host.status === "connected")
                .map((host) => host.id);
        if (hostIds.length === 0) {
          throw new Error("No connected machine to install the skills onto.");
        }
        const result = await sdk.system.installCliSkills({ hostIds });
        if (outputJson(options, result)) return;
        for (const entry of result.results) {
          if (!entry.ok) {
            console.error(`${entry.hostName}: ${entry.errorMessage}`);
            continue;
          }
          for (const installation of entry.installations) {
            console.log(
              `${entry.hostName}: installed ${installation.name} to ${installation.path}`,
            );
          }
        }
        if (result.results.some((entry) => !entry.ok)) {
          throw new Error("The install failed on at least one machine.");
        }
      }),
    );
}
