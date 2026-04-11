#!/usr/bin/env node
import { Command } from "commander";
import { runBootstrap } from "./commands/bootstrap.js";
import { runDeploy } from "./commands/deploy.js";
import { runDiff } from "./commands/diff.js";
import { runInit } from "./commands/init.js";
import { runRemove } from "./commands/remove.js";
import { runSynth } from "./commands/synth.js";
import { runValidate } from "./commands/validate.js";

const program = new Command();

type CliOptionValue = string | boolean;
type CliOptionMap = Record<string, CliOptionValue>;

function toCamelCaseOptionName(value: string): string {
  return value.replace(/-([a-zA-Z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function setCliOptionValue(
  options: CliOptionMap,
  key: string,
  value: CliOptionValue,
): void {
  if (!key) return;
  options[key] = value;

  const camelCaseKey = toCamelCaseOptionName(key);
  if (camelCaseKey !== key) {
    options[camelCaseKey] = value;
  }
}

function isCliOptionValueToken(token: string): boolean {
  return !token.startsWith("-") || /^-\d+(\.\d+)?$/.test(token);
}

function collectCliOptionVariables(argv: readonly string[]): CliOptionMap {
  const options: CliOptionMap = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") break;
    if (!token.startsWith("--")) continue;

    if (token.startsWith("--no-")) {
      setCliOptionValue(options, token.slice(5), false);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex > -1) {
      const key = token.slice(2, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      setCliOptionValue(options, key, value);
      continue;
    }

    const key = token.slice(2);
    const nextToken = argv[index + 1];
    if (nextToken !== undefined && isCliOptionValueToken(nextToken)) {
      setCliOptionValue(options, key, nextToken);
      index += 1;
      continue;
    }

    setCliOptionValue(options, key, true);
  }

  return options;
}

program
  .name("yamlcdk")
  .description("AWS YAML-to-CDK deployment CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Create a starter config")
  .option("-c, --config <path>", "Config file path", "yamlcdk.yml")
  .option(
    "-f, --format <format>",
    "Config format (yamlcdk or cloudformation)",
    "yamlcdk",
  )
  .action((opts: { config: string; format: string }) => {
    runInit(opts.config, opts.format);
  });

program
  .command("validate")
  .description("Validate YAML config")
  .option("-c, --config <path>", "Config file path", "yamlcdk.yml")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action((opts: { config: string }) => {
    runValidate(opts.config, collectCliOptionVariables(process.argv.slice(2)));
  });

function withAwsFlags<T extends Command>(cmd: T): T {
  return cmd
    .requiredOption("-c, --config <path>", "Config file path")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .option("--region <region>", "AWS region override")
    .option("--profile <profile>", "AWS profile override")
    .option("--account <account>", "AWS account override");
}

withAwsFlags(program.command("synth").description("Synthesize CloudFormation"))
  .action(
    (opts: {
      config: string;
      region?: string;
      profile?: string;
      account?: string;
    }) => {
      runSynth({
        ...opts,
        opt: collectCliOptionVariables(process.argv.slice(2)),
      });
    },
  );

withAwsFlags(program.command("bootstrap").description("Bootstrap CDK environment"))
  .action(
    (opts: {
      config: string;
      region?: string;
      profile?: string;
      account?: string;
    }) => {
      runBootstrap({
        ...opts,
        opt: collectCliOptionVariables(process.argv.slice(2)),
      });
    },
  );

withAwsFlags(program.command("diff").description("Show CDK diff"))
  .action(
    (opts: {
      config: string;
      region?: string;
      profile?: string;
      account?: string;
    }) => {
      runDiff({
        ...opts,
        opt: collectCliOptionVariables(process.argv.slice(2)),
      });
    },
  );

withAwsFlags(program.command("deploy").description("Deploy stack"))
  .option(
    "--require-approval",
    "Require approval for security-related changes",
    false,
  )
  .action(
    (opts: {
      config: string;
      region?: string;
      profile?: string;
      account?: string;
      requireApproval?: boolean;
    }) => {
      runDeploy({
        ...opts,
        opt: collectCliOptionVariables(process.argv.slice(2)),
      });
    },
  );

withAwsFlags(program.command("remove").description("Destroy stack"))
  .option("--force", "Force destruction without confirmation", false)
  .action(
    (opts: {
      config: string;
      region?: string;
      profile?: string;
      account?: string;
      force?: boolean;
    }) => {
      runRemove({
        ...opts,
        opt: collectCliOptionVariables(process.argv.slice(2)),
      });
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`\nyamlcdk error:\n${error.message}\n`);
  process.exit(1);
});
