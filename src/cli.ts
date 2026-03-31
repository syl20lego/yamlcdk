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

program
  .name("yamlcdk")
  .description("AWS YAML-to-CDK deployment CLI")
  .version("0.1.0");

program
  .command("init")
  .description("Create a starter YAML config")
  .option("-c, --config <path>", "Config file path", "yamlcdk.yml")
  .action((opts: { config: string }) => {
    runInit(opts.config);
  });

program
  .command("validate")
  .description("Validate YAML config")
  .option("-c, --config <path>", "Config file path", "yamlcdk.yml")
  .action((opts: { config: string }) => {
    runValidate(opts.config);
  });

function withAwsFlags<T extends Command>(cmd: T): T {
  return cmd
    .requiredOption("-c, --config <path>", "Config file path")
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
      runSynth(opts);
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
      runBootstrap(opts);
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
      runDiff(opts);
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
      runDeploy(opts);
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
      runRemove(opts);
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  process.stderr.write(`\nyamlcdk error:\n${error.message}\n`);
  process.exit(1);
});
