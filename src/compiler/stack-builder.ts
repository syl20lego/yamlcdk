import cdk from "aws-cdk-lib";
import { Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { ServiceModel } from "./model.js";
import { serviceModelSchema } from "./model.js";
import type { NormalizedServiceConfig } from "../config/normalize.js";
import type { EventBinding, CompilationContext } from "./plugins/index.js";
import { DomainConfigs } from "./plugins/index.js";
import type { DomainRegistry } from "./plugins/registry.js";
import { createNativeDomainRegistry } from "./domains/index.js";
import { createStackSynthesizer } from "./synthesizer.js";
import { validateDeploymentMode } from "./stack/validation.js";
import { adaptConfig } from "../definitions/yamlcdk/plugin.js";

export class ServiceStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    readonly model: ServiceModel,
    domainRegistry: DomainRegistry,
    props?: StackProps,
  ) {
    super(scope, id, props);

    Tags.of(this).add("Service", model.service);
    Tags.of(this).add("Stage", model.provider.stage);
    Object.entries(model.provider.tags ?? {}).forEach(([k, v]) => {
      Tags.of(this).add(k, v);
    });

    const refs: Record<string, Construct> = {};
    const ctx: CompilationContext = { stack: this, model, refs };
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
  options?: { outdir?: string },
): { app: cdk.App; stack: ServiceStack } {
  const model = isServiceModel(input) ? input : adaptConfig(input);
  validateDeploymentMode(model);
  const app = new cdk.App({ outdir: options?.outdir });
  const synthesizer = createStackSynthesizer(model);
  const domainRegistry = createNativeDomainRegistry();
  const stack = new ServiceStack(
    app,
    model.stackName,
    model,
    domainRegistry,
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
