import cdk, { CfnOutput } from "aws-cdk-lib";
import { CfnElement, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { ServiceModel } from "./model.js";
import { serviceModelSchema } from "./model.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import type {
  EventBinding,
  CompilationContext,
  DomainValidationContribution,
} from "./plugins/index.js";
import { DomainConfigs } from "./plugins/index.js";
import type { DomainRegistry } from "./plugins/registry.js";
import { createNativeDomainRegistry } from "./domains/index.js";
import { createStackSynthesizer } from "./synthesizer.js";
import { validateDeploymentMode } from "./stack/validation.js";
import { adaptConfig } from "../definitions/yamlcdk/plugin.js";
import type { BuildResult } from "../runtime/build.js";
import { prepareFunctionBuilds } from "../runtime/build.js";

export class ServiceStack extends Stack {
  readonly refs: Record<string, Construct>;
  readonly validationContributions: readonly DomainValidationContribution[];

  constructor(
    scope: Construct,
    id: string,
    readonly model: ServiceModel,
    domainRegistry: DomainRegistry,
    builds: Readonly<Record<string, BuildResult>>,
    props?: StackProps,
  ) {
    super(scope, id, props);

    Tags.of(this).add("Service", model.service);
    Tags.of(this).add("Stage", model.provider.stage);
    Object.entries(model.provider.tags ?? {}).forEach(([k, v]) => {
      Tags.of(this).add(k, v);
    });

    const refs: Record<string, Construct> = {};
    this.refs = refs;
    const availableOutputs = new Map<string, string>();
    const ctx: CompilationContext = { stack: this, model, refs, builds, availableOutputs };
    const domains = domainRegistry.all();

    // Phase 1: Validate
    for (const domain of domains) {
      domain.validate?.(ctx);
    }

    // Phase 2: Synthesize and collect event bindings
    const allEvents: EventBinding[] = [];
    for (const domain of domains) {
      const result = domain.synthesize?.(ctx);
      if (result?.events) {
        allEvents.push(...result.events);
      }
    }

    // Phase 3: Bind events to resources
    for (const domain of domains) {
      domain.bind?.(ctx, allEvents);
    }

    // Phase 4: Finalize (outputs, cleanup)
    for (const domain of domains) {
      domain.finalize?.(ctx);
    }

    // Phase 5: Emit passthrough outputs from source definition
    if (model.passthroughOutputs) {
      for (const [logicalId, outputDef] of Object.entries(
        model.passthroughOutputs,
      )) {
        if ("Value" in outputDef) {
          new RawCfnOutput(this, `Passthrough${logicalId}`, logicalId, outputDef);
          continue;
        }

        // Auto-fill Value from domain-provided output registry
        const autoValue = availableOutputs.get(logicalId);
        if (autoValue) {
          const exportDef = outputDef.Export as
            | { Name?: string }
            | undefined;
          const output = new CfnOutput(this, `Passthrough${logicalId}`, {
            value: autoValue,
            exportName: exportDef?.Name,
            description: outputDef.Description as string | undefined,
          });
          output.overrideLogicalId(logicalId);
          continue;
        }

        const available = [...availableOutputs.keys()].sort().join(", ");
        throw new Error(
          `Output "${logicalId}" is missing a required "Value" property and does not match ` +
          `any domain-provided output. Add a Value to resources.Outputs.${logicalId}, ` +
          `or use one of these available output names: ${available || "(none)"}`,
        );
      }
    }

    const contributions: DomainValidationContribution[] = [];
    for (const domain of domains) {
      const values = domain.describeValidation?.(ctx);
      if (values?.length) {
        contributions.push(...values);
      }
    }
    this.validationContributions = contributions;
  }
}

// Detect ServiceModel by validating serializable fields via Zod.
function isServiceModel(input: unknown): input is ServiceModel {
  if (
    input === null ||
    typeof input !== "object" ||
    !("domainConfigs" in input) ||
    !((input as { domainConfigs: unknown }).domainConfigs instanceof DomainConfigs)
  ) {
    return false;
  }
  return serviceModelSchema.safeParse(input).success;
}

export function buildApp(
  input: ServiceModel | NormalizedServiceConfig,
  options?: { outdir?: string; stubBuild?: boolean },
): { app: cdk.App; stack: ServiceStack } {
  const model = isServiceModel(input) ? input : adaptConfig(input);
  validateDeploymentMode(model);
  const builds = prepareFunctionBuilds(model, { stub: options?.stubBuild });
  const app = new cdk.App({ outdir: options?.outdir });
  const synthesizer = createStackSynthesizer(model);
  const domainRegistry = createNativeDomainRegistry();
  const stack = new ServiceStack(
    app,
    model.stackName,
    model,
    domainRegistry,
    builds,
    {
      env: {
        account: model.provider.account,
        region: model.provider.region,
      },
      synthesizer,
    },
  );
  return { app, stack };
}

/**
 * Emits a raw CloudFormation Output entry, preserving intrinsic
 * functions as-is without CDK token conversion.
 */
class RawCfnOutput extends CfnElement {
  constructor(
    scope: Construct,
    id: string,
    private readonly outputKey: string,
    private readonly rawOutput: Record<string, unknown>,
  ) {
    super(scope, id);
  }

  /** @internal */
  public _toCloudFormation(): Record<string, unknown> {
    return {
      Outputs: {
        [this.outputKey]: this.rawOutput,
      },
    };
  }
}
