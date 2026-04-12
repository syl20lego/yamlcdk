import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import type { ServiceModel } from "../compiler/model.js";
import { buildApp } from "../compiler/stack-builder.js";

const require = createRequire(import.meta.url);

/**
 * Config shape accepted by CDK runtime operations.
 * Both NormalizedServiceConfig and ServiceModel satisfy this
 * through structural compatibility.
 */
type CdkRuntimeConfig = ServiceModel | NormalizedServiceConfig;

function extractAccountFromRoleArn(roleArn?: string): string | undefined {
  if (!roleArn) return undefined;
  const match = roleArn.match(/^arn:aws:iam::(\d{12}):role\/.+/i);
  return match?.[1];
}

function resolveCdkBin(): string {
  const searchPaths = [process.cwd(), path.dirname(import.meta.filename)];
  for (const basePath of searchPaths) {
    try {
      const cdkPackageJson = require.resolve("aws-cdk/package.json", {
        paths: [basePath],
      });
      const cdkDir = path.dirname(cdkPackageJson);
      const pkg = JSON.parse(
        fs.readFileSync(cdkPackageJson, "utf8"),
      ) as { bin?: string | Record<string, string> };
      const relativeBin =
        typeof pkg.bin === "string"
          ? pkg.bin
          : (pkg.bin?.cdk ?? "bin/cdk");
      const cdkBin = path.join(cdkDir, relativeBin);
      if (fs.existsSync(cdkBin)) {
        return cdkBin;
      }
    } catch {
      // Continue with next search path.
    }
  }

  throw new Error(
    `Unable to resolve aws-cdk binary. Install "aws-cdk" in your project (cwd: ${process.cwd()}) or in the CLI package.`,
  );
}

function runCdk(args: string[], env: NodeJS.ProcessEnv): void {
  const cdkBin = resolveCdkBin();
  const result = spawnSync(process.execPath, [cdkBin, ...args], {
    env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const hasDestroyTtyConfirmationError =
      /Destroying stacks is an irreversible action, but terminal \(TTY\) is not attached/i.test(
        output,
      ) &&
      /destroy/i.test(args.join(" "));
    const hasLambdaUnzippedSizeError =
      /Unzipped size must be smaller than 262144000 bytes/i.test(output);
    if (hasLambdaUnzippedSizeError) {
      throw new Error(
        `Lambda deployment package is too large (unzipped > 250 MB).\n` +
          `Likely cause: handler packaging included too many files.\n` +
          `Use a narrower handler path (e.g., src/handlers/<name>.handler) and keep only runtime files in that directory.\n` +
          `If needed, move large dependencies to Lambda Layers.`,
      );
    }
    if (hasDestroyTtyConfirmationError) {
      throw new Error(
        `Destroy requires confirmation but no interactive TTY is attached.\n` +
          `Re-run with:\n  yamlcdk remove -c <config.yml> --force`,
      );
    }

    throw new Error(
      `CDK command failed: node ${cdkBin} ${args.join(" ")} (exit ${result.status ?? "unknown"}).`,
    );
  }
}

export function deployMode(config: CdkRuntimeConfig): "cdk" | "cloudformation-service-role" {
  return config.provider.deployment?.cloudFormationServiceRoleArn
    ? "cloudformation-service-role"
    : "cdk";
}

function hasCdkAssetMetadata(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasCdkAssetMetadata(item));
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key === "aws:asset:path" || key === "aws:asset:property") {
        return true;
      }
      if (hasCdkAssetMetadata(nested)) {
        return true;
      }
    }
  }
  return false;
}

export function assertTemplateOnlyStack(templateFile: string): void {
  const template = JSON.parse(fs.readFileSync(templateFile, "utf8")) as unknown;
  if (hasCdkAssetMetadata(template)) {
    throw new Error(
      `provider.deployment.cloudFormationServiceRoleArn currently supports template-only stacks (no CDK assets).\n` +
        `Detected synthesized CDK asset metadata in template. Remove asset-backed resources (for example Lambda code/image assets) or use standard CDK deployment mode.`,
    );
  }
}

function runCloudFormationDeployWithRole(
  config: CdkRuntimeConfig,
  templateFile: string,
  env: NodeJS.ProcessEnv,
): void {
  const roleArn = config.provider.deployment?.cloudFormationServiceRoleArn;
  if (!roleArn) {
    throw new Error("cloudFormationServiceRoleArn is required for CloudFormation service-role deployment mode.");
  }
  assertTemplateOnlyStack(templateFile);
  const args = [
    "cloudformation",
    "deploy",
    "--template-file",
    templateFile,
    "--stack-name",
    config.stackName,
    "--role-arn",
    roleArn,
    "--capabilities",
    "CAPABILITY_IAM",
    "CAPABILITY_NAMED_IAM",
    "CAPABILITY_AUTO_EXPAND",
    "--no-fail-on-empty-changeset",
  ];
  const result = spawnSync("aws", args, { env, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(
      `CloudFormation deploy failed with service role.\nCommand: aws ${args.join(" ")}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

function synthToTemp(config: CdkRuntimeConfig): string {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-cdk-"));
  const { app } = buildApp(config, { outdir });
  app.synth();
  return outdir;
}

function buildEnv(config: CdkRuntimeConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.provider.profile) env.AWS_PROFILE = config.provider.profile;
  env.AWS_REGION = config.provider.region;
  env.CDK_DEFAULT_REGION = config.provider.region;
  env.CDK_DEFAULT_ACCOUNT =
    config.provider.account ??
    extractAccountFromRoleArn(config.provider.deployment?.deployRoleArn) ??
    extractAccountFromRoleArn(
      config.provider.deployment?.cloudFormationExecutionRoleArn,
  ) ??
    env.CDK_DEFAULT_ACCOUNT;
  return env;
}

function cdkCloudFormationRoleArgs(config: CdkRuntimeConfig): string[] {
  const deployment = config.provider.deployment;
  const useCliCredentials =
    deployment?.useCliCredentials ??
    Boolean(
      (deployment?.fileAssetsBucketName || deployment?.imageAssetsRepositoryName) &&
        !deployment?.deployRoleArn,
    );
  return useCliCredentials && deployment?.cloudFormationExecutionRoleArn
    ? ["--role-arn", deployment.cloudFormationExecutionRoleArn]
    : [];
}

function printStackOutputs(config: CdkRuntimeConfig, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      config.stackName,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    { env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    return;
  }
  const outputs = JSON.parse(result.stdout || "[]") as Array<{
    OutputKey?: string;
    OutputValue?: string;
  }>;
  if (!outputs.length) {
    return;
  }
  process.stdout.write("\nStack outputs:\n");
  for (const output of outputs) {
    if (!output.OutputKey) continue;
    process.stdout.write(`- ${output.OutputKey}: ${output.OutputValue ?? ""}\n`);
  }
}

export function cdkSynth(config: CdkRuntimeConfig): void {
  const outdir = synthToTemp(config);
  const template = path.join(outdir, `${config.stackName}.template.json`);
  const content = fs.readFileSync(template, "utf8");
  process.stdout.write(content);
}

export function cdkDeploy(config: CdkRuntimeConfig, requireApproval: boolean): void {
  const outdir = synthToTemp(config);
  const env = buildEnv(config);
  const template = path.join(outdir, `${config.stackName}.template.json`);
  if (deployMode(config) === "cloudformation-service-role") {
    if (requireApproval) {
      throw new Error(
        `--require-approval is not supported when provider.deployment.cloudFormationServiceRoleArn is set. Use CloudFormation change-set review outside yamlcdk for approval.`,
      );
    }
    runCloudFormationDeployWithRole(config, template, env);
    printStackOutputs(config, env);
    return;
  }
  const deployArgs = [
    "deploy",
    config.stackName,
    "--app",
    outdir,
    ...cdkCloudFormationRoleArgs(config),
    ...(requireApproval ? [] : ["--require-approval", "never"]),
  ];
  runCdk(deployArgs, env);
  printStackOutputs(config, env);
}

export function cdkDiff(config: CdkRuntimeConfig): void {
  const outdir = synthToTemp(config);
  runCdk(
    ["diff", config.stackName, "--app", outdir, ...cdkCloudFormationRoleArgs(config)],
    buildEnv(config),
  );
}

export function cdkDestroy(config: CdkRuntimeConfig, force: boolean): void {
  const outdir = synthToTemp(config);
  runCdk(
    [
      "destroy",
      config.stackName,
      "--app",
      outdir,
      ...cdkCloudFormationRoleArgs(config),
      ...(force ? ["--force"] : []),
    ],
    buildEnv(config),
  );
}
