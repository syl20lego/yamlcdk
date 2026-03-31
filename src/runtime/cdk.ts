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

class CdkBootstrapMissingError extends Error {
  constructor(
    readonly account: string | undefined,
    readonly region: string,
    readonly cdkCommand: string,
    readonly yamlcdkCommand: string,
    readonly hasAssumeRoleWarning: boolean,
  ) {
    super(
      `CDK bootstrap is missing for this AWS environment.\n` +
        `Reason: CDK could not find the bootstrap SSM parameter (/cdk-bootstrap/.../version).\n` +
        `${hasAssumeRoleWarning ? `Note: The "could not be used to assume ... deploy-role" warning is usually informational; the blocking issue is missing bootstrap.\n` : ""}` +
        `${account ? `Detected target: account ${account}, region ${region}.\n` : `Detected region: ${region}.\n`}` +
        `Run one of these:\n` +
        `  ${yamlcdkCommand}\n` +
        `  ${cdkCommand}\n` +
        `Then retry your original command.`,
    );
  }
}

class CdkBootstrapDeleteFailedError extends Error {
  constructor(
    readonly account: string | undefined,
    readonly region: string,
    readonly roleHint: string | undefined,
    readonly profile: string | undefined,
  ) {
    const bootstrapTarget = account ? `aws://${account}/${region}` : `<account>/${region}`;
    super(
      `CDK bootstrap failed because the existing CDKToolkit stack is stuck in DELETE_FAILED.\n` +
        `Detected target: ${bootstrapTarget}.\n` +
        `${roleHint ? `Likely blocker: IAM role still in use or protected (${roleHint}).\n` : ""}` +
        `How to fix:\n` +
        `  1) In CloudFormation console, open stack "CDKToolkit" in ${region}.\n` +
        `  2) Delete or retain the failing IAM resource(s), then remove the failed stack.\n` +
        `  3) Re-run bootstrap:\n` +
        `     npx cdk bootstrap ${account ? `aws://${account}/${region}` : ""}${profile ? ` --profile ${profile}` : ""}\n` +
        `  4) Retry deploy: yamlcdk deploy -c <config.yml>`,
    );
  }
}

class CdkBootstrapBucketConflictError extends Error {
  constructor(
    readonly account: string | undefined,
    readonly region: string,
    readonly conflictingBucket: string | undefined,
  ) {
    const target = account ? `aws://${account}/${region}` : `<account>/${region}`;
    super(
      `CDK bootstrap failed because the default bootstrap bucket already exists outside the CDKToolkit stack.\n` +
        `Detected target: ${target}.\n` +
        `${conflictingBucket ? `Conflicting bucket: ${conflictingBucket}\n` : ""}` +
        `Why this happens: your deploy is using custom deployment settings, but auto-bootstrap attempted to create default CDKToolkit resources.\n` +
        `What to do:\n` +
        `  - Keep your custom provider.deployment config and skip bootstrap, OR\n` +
        `  - Manually clean up/reconcile the existing default bootstrap resources before bootstrapping.\n` +
        `Tip: set provider.deployment.requireBootstrap=false for custom deployment mode.`,
    );
  }
}

function hasCustomDeploymentOverrides(config: CdkRuntimeConfig): boolean {
  const deployment = config.provider.deployment;
  return Boolean(
    deployment?.fileAssetsBucketName ||
      deployment?.imageAssetsRepositoryName ||
      deployment?.cloudFormationServiceRoleArn ||
      deployment?.cloudFormationExecutionRoleArn ||
      deployment?.deployRoleArn ||
      deployment?.useCliCredentials,
  );
}

function extractAccountFromRoleArn(roleArn?: string): string | undefined {
  if (!roleArn) return undefined;
  const match = roleArn.match(/^arn:aws:iam::(\d{12}):role\/.+/i);
  return match?.[1];
}

function inferBootstrapAccountRegion(
  config: CdkRuntimeConfig,
  output: string,
  env: NodeJS.ProcessEnv,
): { account?: string; region?: string } {
  const account =
    env.CDK_DEFAULT_ACCOUNT ??
    config.provider.account ??
    extractAccountFromRoleArn(config.provider.deployment?.deployRoleArn) ??
    extractAccountFromRoleArn(
      config.provider.deployment?.cloudFormationExecutionRoleArn,
    );
  const region = env.CDK_DEFAULT_REGION ?? env.AWS_REGION;
  if (account && region) {
    return { account, region };
  }

  const roleMatch = output.match(
    /arn:aws:iam::(\d{12}):role\/cdk-[^-]+-deploy-role-\d{12}-([a-z0-9-]+)/i,
  );
  if (roleMatch) {
    return {
      account: account ?? roleMatch[1],
      region: region ?? roleMatch[2],
    };
  }

  return { account, region };
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

function runCdk(
  config: CdkRuntimeConfig,
  args: string[],
  env: NodeJS.ProcessEnv,
): void {
  const cdkBin = resolveCdkBin();
  const result = spawnSync(process.execPath, [cdkBin, ...args], {
    env,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const hasBootstrapError =
      /\/cdk-bootstrap\/.+\/version not found/i.test(output) ||
      /Has the environment been bootstrapped\?/i.test(output);
    const hasDestroyTtyConfirmationError =
      /Destroying stacks is an irreversible action, but terminal \(TTY\) is not attached/i.test(
        output,
      ) &&
      /destroy/i.test(args.join(" "));
    const hasLambdaUnzippedSizeError =
      /Unzipped size must be smaller than 262144000 bytes/i.test(output);
    const hasBootstrapDeleteFailed =
      /CDKToolkit/i.test(output) &&
      /DELETE_FAILED/i.test(output) &&
      /bootstrap/i.test(args.join(" "));
    const hasBootstrapBucketConflict =
      /CDKToolkit/i.test(output) &&
      /StagingBucket/i.test(output) &&
      /already exists/i.test(output) &&
      /bootstrap/i.test(args.join(" "));
    const hasAssumeRoleWarning =
      /current credentials could not be used to assume/i.test(output);
    if (hasBootstrapDeleteFailed) {
      const inferred = inferBootstrapAccountRegion(config, output, env);
      const roleMatch = output.match(/\[(.+Role)\]/i);
      const roleHint = roleMatch?.[1];
      throw new CdkBootstrapDeleteFailedError(
        inferred.account,
        inferred.region ?? "us-east-1",
        roleHint,
        env.AWS_PROFILE,
      );
    }
    if (hasBootstrapBucketConflict) {
      const inferred = inferBootstrapAccountRegion(config, output, env);
      const bucketMatch = output.match(
        /identifier '([^']+)' already exists/i,
      );
      throw new CdkBootstrapBucketConflictError(
        inferred.account,
        inferred.region ?? "us-east-1",
        bucketMatch?.[1],
      );
    }
    if (hasBootstrapError) {
      const inferred = inferBootstrapAccountRegion(config, output, env);
      const account = inferred.account;
      const region = inferred.region ?? "us-east-1";
      const bootstrapTarget = account ? `aws://${account}/${region}` : "";
      const cdkCommand = bootstrapTarget
        ? `npx cdk bootstrap ${bootstrapTarget}${env.AWS_PROFILE ? ` --profile ${env.AWS_PROFILE}` : ""}`
        : `npx cdk bootstrap${env.AWS_PROFILE ? ` --profile ${env.AWS_PROFILE}` : ""}`;
      const yamlcdkCommand = account
        ? `yamlcdk bootstrap -c <config.yml> --account ${account} --region ${region}${env.AWS_PROFILE ? ` --profile ${env.AWS_PROFILE}` : ""}`
        : `yamlcdk bootstrap -c <config.yml> --region ${region}${env.AWS_PROFILE ? ` --profile ${env.AWS_PROFILE}` : ""}`;
      throw new CdkBootstrapMissingError(
        account,
        region,
        cdkCommand,
        yamlcdkCommand,
        hasAssumeRoleWarning,
      );
    }
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
  try {
    runCdk(config, deployArgs, env);
    printStackOutputs(config, env);
  } catch (error) {
    if (error instanceof CdkBootstrapMissingError) {
      if (hasCustomDeploymentOverrides(config)) {
        throw new Error(
          `Bootstrap is missing, but custom provider.deployment overrides are configured.\n` +
            `yamlcdk will not auto-bootstrap in this mode to avoid creating conflicting default CDKToolkit resources.\n` +
            `Note: requireBootstrap may already be inferred as false, but using deployRoleArn still uses DefaultStackSynthesizer, which requires a bootstrapped environment.\n` +
            `Choose one:\n` +
            `  1) Keep role overrides and bootstrap once (yamlcdk bootstrap -c <config.yml> --account <account> --region <region>)\n` +
            `  2) Use CLI-credentials mode: remove deployRoleArn and set useCliCredentials: true (optionally keeping cloudFormationExecutionRoleArn) with your asset bucket overrides.`,
        );
      }
      const bootstrapTarget = error.account
        ? `aws://${error.account}/${error.region}`
        : undefined;
      process.stderr.write(
        `\nyamlcdk: Bootstrap is missing. Running bootstrap automatically, then retrying deploy...\n`,
      );
      runCdk(config, ["bootstrap", ...(bootstrapTarget ? [bootstrapTarget] : [])], env);
      runCdk(config, deployArgs, env);
      printStackOutputs(config, env);
      return;
    }
    if (error instanceof CdkBootstrapDeleteFailedError) {
      throw error;
    }
    if (error instanceof CdkBootstrapBucketConflictError) {
      throw error;
    }
    throw error;
  }
}

export function cdkDiff(config: CdkRuntimeConfig): void {
  const outdir = synthToTemp(config);
  runCdk(
    config,
    ["diff", config.stackName, "--app", outdir, ...cdkCloudFormationRoleArgs(config)],
    buildEnv(config),
  );
}

export function cdkDestroy(config: CdkRuntimeConfig, force: boolean): void {
  const outdir = synthToTemp(config);
  runCdk(
    config,
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

export function cdkBootstrap(config: CdkRuntimeConfig): void {
  const env = buildEnv(config);
  const target = config.provider.account
    ? `aws://${config.provider.account}/${config.provider.region}`
    : undefined;
  runCdk(config, ["bootstrap", ...(target ? [target] : [])], env);
}
