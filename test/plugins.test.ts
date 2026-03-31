import { describe, expect, test } from "vitest";
import {
  DomainConfigs,
  createDomainConfigKey,
  PluginRegistry,
  DomainRegistry,
  DefinitionRegistry,
} from "../src/compiler/plugins/index.js";
import type {
  DomainPlugin,
  CompilationContext,
  EventBinding,
  SynthesisResult,
} from "../src/compiler/plugins/index.js";
import type { DefinitionPlugin } from "../src/compiler/plugins/definition-plugin.js";
import type { ServiceModel } from "../src/compiler/model.js";
import { yamlcdkDefinitionPlugin, adaptConfig } from "../src/definitions/yamlcdk/index.js";
import { normalizeConfig } from "../src/config/normalize.js";
import { validateServiceConfig } from "../src/config/schema.js";
import { nativeDomains, createNativeDomainRegistry } from "../src/compiler/domains/index.js";
import { S3_CONFIG, DYNAMODB_CONFIG, SQS_CONFIG, SNS_CONFIG, APIS_CONFIG } from "../src/compiler/plugins/native-domain-configs.js";

// ─── DomainConfigs ──────────────────────────────────────────

describe("DomainConfigs", () => {
  test("set and get with typed key", () => {
    interface TestConfig { value: number }
    const KEY = createDomainConfigKey<TestConfig>("test");
    const configs = new DomainConfigs();
    configs.set(KEY, { value: 42 });
    expect(configs.get(KEY)).toEqual({ value: 42 });
  });

  test("get returns undefined for missing key", () => {
    const KEY = createDomainConfigKey<string>("missing");
    const configs = new DomainConfigs();
    expect(configs.get(KEY)).toBeUndefined();
  });

  test("require throws for missing key", () => {
    const KEY = createDomainConfigKey<string>("required");
    const configs = new DomainConfigs();
    expect(() => configs.require(KEY)).toThrow('Required domain config missing: "required"');
  });

  test("has returns correct boolean", () => {
    const KEY = createDomainConfigKey<string>("check");
    const configs = new DomainConfigs();
    expect(configs.has(KEY)).toBe(false);
    configs.set(KEY, "hello");
    expect(configs.has(KEY)).toBe(true);
  });

  test("keys lists all registered keys", () => {
    const A = createDomainConfigKey<string>("a");
    const B = createDomainConfigKey<number>("b");
    const configs = new DomainConfigs();
    configs.set(A, "val");
    configs.set(B, 99);
    expect(configs.keys().sort()).toEqual(["a", "b"]);
  });
});

// ─── DomainRegistry ─────────────────────────────────────────

describe("DomainRegistry", () => {
  test("registers and retrieves plugins", () => {
    const registry = new DomainRegistry();
    const plugin: DomainPlugin = { name: "test" };
    registry.register(plugin);
    expect(registry.get("test")).toBe(plugin);
  });

  test("rejects duplicate registration", () => {
    const registry = new DomainRegistry();
    registry.register({ name: "dup" });
    expect(() => registry.register({ name: "dup" })).toThrow(
      'Domain plugin "dup" is already registered.',
    );
  });

  test("all() returns plugins in insertion order", () => {
    const registry = new DomainRegistry();
    registry.register({ name: "a" });
    registry.register({ name: "b" });
    registry.register({ name: "c" });
    expect(registry.all().map((p) => p.name)).toEqual(["a", "b", "c"]);
  });
});

// ─── DefinitionRegistry ─────────────────────────────────────

describe("DefinitionRegistry", () => {
  test("resolves matching plugin", () => {
    const registry = new DefinitionRegistry();
    const plugin: DefinitionPlugin = {
      formatName: "test",
      canLoad: (f) => f.endsWith(".test"),
      load: () => ({} as ServiceModel),
    };
    registry.register(plugin);
    expect(registry.resolve("config.test")).toBe(plugin);
  });

  test("throws when no plugin matches", () => {
    const registry = new DefinitionRegistry();
    expect(() => registry.resolve("unknown.format")).toThrow(
      "No definition plugin can load",
    );
  });

  test("rejects duplicate format registration", () => {
    const registry = new DefinitionRegistry();
    const plugin: DefinitionPlugin = {
      formatName: "dup",
      canLoad: () => true,
      load: () => ({} as ServiceModel),
    };
    registry.register(plugin);
    expect(() => registry.register({ ...plugin })).toThrow(
      'Definition plugin "dup" is already registered.',
    );
  });
});

// ─── PluginRegistry ─────────────────────────────────────────

describe("PluginRegistry", () => {
  test("holds domain and definition registries", () => {
    const registry = new PluginRegistry();
    expect(registry.domains).toBeInstanceOf(DomainRegistry);
    expect(registry.definitions).toBeInstanceOf(DefinitionRegistry);
  });
});

// ─── Native domain registration ─────────────────────────────

describe("native domains", () => {
  test("all 7 native domains are declared", () => {
    expect(nativeDomains).toHaveLength(7);
    const names = nativeDomains.map((d) => d.name);
    expect(names).toContain("s3");
    expect(names).toContain("dynamodb");
    expect(names).toContain("sqs");
    expect(names).toContain("sns");
    expect(names).toContain("functions");
    expect(names).toContain("eventbridge");
    expect(names).toContain("apis");
  });

  test("createNativeDomainRegistry registers all domains", () => {
    const registry = createNativeDomainRegistry();
    expect(registry.all()).toHaveLength(7);
    expect(registry.get("s3")).toBeDefined();
    expect(registry.get("functions")).toBeDefined();
  });

  test("lifecycle order: resource domains before functions before binding domains", () => {
    const names = nativeDomains.map((d) => d.name);
    const functionsIdx = names.indexOf("functions");
    const s3Idx = names.indexOf("s3");
    const dynamodbIdx = names.indexOf("dynamodb");
    const sqsIdx = names.indexOf("sqs");
    const snsIdx = names.indexOf("sns");
    const eventbridgeIdx = names.indexOf("eventbridge");
    const apisIdx = names.indexOf("apis");

    // Resource domains come before functions
    expect(s3Idx).toBeLessThan(functionsIdx);
    expect(dynamodbIdx).toBeLessThan(functionsIdx);
    expect(sqsIdx).toBeLessThan(functionsIdx);
    expect(snsIdx).toBeLessThan(functionsIdx);

    // Functions comes before binding-only domains
    expect(functionsIdx).toBeLessThan(eventbridgeIdx);
    expect(functionsIdx).toBeLessThan(apisIdx);
  });
});

// ─── yamlcdk definition plugin ─────────────────────────────────

describe("yamlcdk definition plugin", () => {
  test("canLoad matches yml and yaml extensions", () => {
    expect(yamlcdkDefinitionPlugin.canLoad("yamlcdk.yml")).toBe(true);
    expect(yamlcdkDefinitionPlugin.canLoad("config.yaml")).toBe(true);
    expect(yamlcdkDefinitionPlugin.canLoad("config.json")).toBe(false);
    expect(yamlcdkDefinitionPlugin.canLoad("serverless.yml")).toBe(true);
  });

  test("generateStarter returns valid YAML content", () => {
    const content = yamlcdkDefinitionPlugin.generateStarter!();
    expect(content).toContain("service:");
    expect(content).toContain("provider:");
    expect(content).toContain("functions:");
    expect(content).toContain("storage:");
  });

  test("formatName is yamlcdk", () => {
    expect(yamlcdkDefinitionPlugin.formatName).toBe("yamlcdk");
  });
});

// ─── Config adaptation ──────────────────────────────────────

describe("adaptConfig", () => {
  test("converts NormalizedServiceConfig to ServiceModel", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { stage: "prod", region: "eu-west-1" },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    expect(model.service).toBe("demo");
    expect(model.stackName).toBe("demo-prod");
    expect(model.provider.region).toBe("eu-west-1");
    expect(model.provider.stage).toBe("prod");
    expect(model.domainConfigs).toBeInstanceOf(DomainConfigs);
  });

  test("populates S3 domain config from storage.s3", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          s3: { cleanupRoleArn: "arn:aws:iam::123456789012:role/Cleanup" },
        },
        storage: {
          s3: { uploads: { versioned: true, autoDeleteObjects: true } },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    const s3Config = model.domainConfigs.require(S3_CONFIG);
    expect(s3Config.buckets.uploads.versioned).toBe(true);
    expect(s3Config.buckets.uploads.autoDeleteObjects).toBe(true);
    expect(s3Config.cleanupRoleArn).toBe("arn:aws:iam::123456789012:role/Cleanup");
  });

  test("populates DynamoDB domain config", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        storage: {
          dynamodb: {
            users: {
              partitionKey: { name: "pk", type: "string" },
              stream: "NEW_AND_OLD_IMAGES",
            },
          },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    const dynamoConfig = model.domainConfigs.require(DYNAMODB_CONFIG);
    expect(dynamoConfig.tables.users.partitionKey.name).toBe("pk");
    expect(dynamoConfig.tables.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("populates SQS and SNS domain configs", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        messaging: {
          sqs: { jobs: { visibilityTimeout: 30 } },
          sns: { events: { subscriptions: [{ type: "sqs", target: "jobs" }] } },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    expect(model.domainConfigs.require(SQS_CONFIG).queues.jobs.visibilityTimeout).toBe(30);
    expect(model.domainConfigs.require(SNS_CONFIG).topics.events.subscriptions).toHaveLength(1);
  });

  test("populates APIs domain config from restApi settings", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: {
          restApi: {
            cloudWatchRoleArn: "arn:aws:iam::123456789012:role/CWRole",
          },
        },
        functions: {},
      }),
    );
    const model = adaptConfig(normalized);
    const apisConfig = model.domainConfigs.require(APIS_CONFIG);
    expect(apisConfig.restApi?.cloudWatchRoleArn).toBe("arn:aws:iam::123456789012:role/CWRole");
  });

  test("flattens function events into EventDeclaration array", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        functions: {
          handler: {
            handler: "src/handler.handler",
            events: {
              http: [{ method: "GET", path: "/a" }],
              rest: [{ method: "POST", path: "/b" }],
              sqs: [{ queue: "ref:q", batchSize: 5 }],
              eventbridge: [{ schedule: "rate(1 hour)" }],
            },
          },
        },
        messaging: { sqs: { q: {} } },
      }),
    );
    const model = adaptConfig(normalized);
    const events = model.functions.handler.events;
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.type).sort()).toEqual([
      "eventbridge",
      "http",
      "rest",
      "sqs",
    ]);
  });

  test("resolves REST apiKeyRequired from global provider setting", () => {
    const normalized = normalizeConfig(
      validateServiceConfig({
        service: "demo",
        provider: { restApi: { apiKeyRequired: true } },
        functions: {
          fn: {
            handler: "src/fn.handler",
            events: { rest: [{ method: "GET", path: "/x" }] },
          },
        },
      }),
    );
    const model = adaptConfig(normalized);
    const restEvent = model.functions.fn.events.find((e) => e.type === "rest");
    expect(restEvent).toBeDefined();
    if (restEvent?.type === "rest") {
      expect(restEvent.apiKeyRequired).toBe(true);
    }
  });
});

// ─── Zod schema validation ──────────────────────────────────

import { z } from "zod";
import {
  serviceModelSchema,
  providerConfigSchema,
  functionModelSchema,
  eventDeclarationSchema,
  iamStatementSchema,
  parseServiceModel,
} from "../src/compiler/model.js";
import {
  s3DomainConfigSchema,
  dynamodbDomainConfigSchema,
  sqsDomainConfigSchema,
  snsDomainConfigSchema,
  apisDomainConfigSchema,
} from "../src/compiler/plugins/native-domain-configs.js";

describe("model Zod schemas", () => {
  test("serviceModelSchema rejects missing service", () => {
    expect(() =>
      serviceModelSchema.parse({
        stackName: "s",
        provider: { region: "us-east-1", stage: "dev" },
        functions: {},
        iam: { statements: {} },
      }),
    ).toThrow();
  });

  test("serviceModelSchema rejects empty region", () => {
    expect(() =>
      serviceModelSchema.parse({
        service: "demo",
        stackName: "demo-dev",
        provider: { region: "", stage: "dev" },
        functions: {},
        iam: { statements: {} },
      }),
    ).toThrow();
  });

  test("providerConfigSchema validates correctly", () => {
    const result = providerConfigSchema.parse({
      region: "us-east-1",
      stage: "dev",
      tags: { env: "dev" },
    });
    expect(result.region).toBe("us-east-1");
    expect(result.tags?.env).toBe("dev");
  });

  test("functionModelSchema rejects empty handler", () => {
    expect(() =>
      functionModelSchema.parse({
        handler: "",
        events: [],
      }),
    ).toThrow();
  });

  test("functionModelSchema rejects invalid timeout", () => {
    expect(() =>
      functionModelSchema.parse({
        handler: "src/handler.handler",
        timeout: 9999,
        events: [],
      }),
    ).toThrow();
  });

  test("eventDeclarationSchema validates http event", () => {
    const result = eventDeclarationSchema.parse({
      type: "http",
      method: "GET",
      path: "/hello",
    });
    expect(result.type).toBe("http");
  });

  test("eventDeclarationSchema rejects unknown event type", () => {
    expect(() =>
      eventDeclarationSchema.parse({
        type: "unknown",
        foo: "bar",
      }),
    ).toThrow();
  });

  test("eventDeclarationSchema validates rest event with apiKeyRequired", () => {
    const result = eventDeclarationSchema.parse({
      type: "rest",
      method: "POST",
      path: "/api",
      apiKeyRequired: true,
    });
    if (result.type === "rest") {
      expect(result.apiKeyRequired).toBe(true);
    }
  });

  test("iamStatementSchema rejects empty actions", () => {
    expect(() =>
      iamStatementSchema.parse({
        actions: [],
        resources: ["*"],
      }),
    ).toThrow();
  });

  test("parseServiceModel rejects object without domainConfigs", () => {
    expect(() =>
      parseServiceModel({
        service: "demo",
        stackName: "demo-dev",
        provider: { region: "us-east-1", stage: "dev" },
        functions: {},
        iam: { statements: {} },
      }),
    ).toThrow("domainConfigs");
  });

  test("parseServiceModel validates and returns ServiceModel", () => {
    const dc = new DomainConfigs();
    const model = parseServiceModel({
      service: "demo",
      stackName: "demo-dev",
      provider: { region: "us-east-1", stage: "dev" },
      functions: {},
      iam: { statements: {} },
      domainConfigs: dc,
    });
    expect(model.service).toBe("demo");
    expect(model.domainConfigs).toBe(dc);
  });
});

describe("domain config Zod schemas", () => {
  test("s3DomainConfigSchema validates buckets", () => {
    const result = s3DomainConfigSchema.parse({
      buckets: { uploads: { versioned: true } },
      cleanupRoleArn: "arn:aws:iam::123:role/R",
    });
    expect(result.buckets.uploads.versioned).toBe(true);
  });

  test("s3DomainConfigSchema rejects invalid cleanupRoleArn", () => {
    expect(() =>
      s3DomainConfigSchema.parse({
        buckets: {},
        cleanupRoleArn: "",
      }),
    ).toThrow();
  });

  test("dynamodbDomainConfigSchema validates table config", () => {
    const result = dynamodbDomainConfigSchema.parse({
      tables: {
        users: {
          partitionKey: { name: "pk", type: "string" },
          stream: "NEW_AND_OLD_IMAGES",
        },
      },
    });
    expect(result.tables.users.stream).toBe("NEW_AND_OLD_IMAGES");
  });

  test("dynamodbDomainConfigSchema rejects invalid key type", () => {
    expect(() =>
      dynamodbDomainConfigSchema.parse({
        tables: {
          users: {
            partitionKey: { name: "pk", type: "boolean" },
          },
        },
      }),
    ).toThrow();
  });

  test("sqsDomainConfigSchema rejects out-of-range visibility timeout", () => {
    expect(() =>
      sqsDomainConfigSchema.parse({
        queues: { q: { visibilityTimeout: 99999 } },
      }),
    ).toThrow();
  });

  test("snsDomainConfigSchema validates subscriptions", () => {
    const result = snsDomainConfigSchema.parse({
      topics: {
        events: {
          subscriptions: [{ type: "sqs", target: "jobs" }],
        },
      },
    });
    expect(result.topics.events.subscriptions).toHaveLength(1);
  });

  test("apisDomainConfigSchema validates restApi config", () => {
    const result = apisDomainConfigSchema.parse({
      restApi: { cloudWatchRoleArn: "arn:aws:iam::123:role/CW" },
    });
    expect(result.restApi?.cloudWatchRoleArn).toBe("arn:aws:iam::123:role/CW");
  });
});

describe("DomainConfigs schema validation on set()", () => {
  test("set() validates value against key schema", () => {
    const dc = new DomainConfigs();
    expect(() =>
      dc.set(S3_CONFIG, {
        buckets: {},
        cleanupRoleArn: "",
      } as any),
    ).toThrow();
  });

  test("set() accepts valid value", () => {
    const dc = new DomainConfigs();
    dc.set(S3_CONFIG, { buckets: { b: { versioned: true } } });
    expect(dc.require(S3_CONFIG).buckets.b.versioned).toBe(true);
  });

  test("set() with schema-less key stores without validation", () => {
    const KEY = createDomainConfigKey<{ x: number }>("no-schema");
    const dc = new DomainConfigs();
    dc.set(KEY, { x: 42 });
    expect(dc.require(KEY).x).toBe(42);
  });
});
