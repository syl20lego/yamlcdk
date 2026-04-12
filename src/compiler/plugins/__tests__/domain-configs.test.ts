import { describe, expect, test } from "vitest";
import { DomainConfigs, createDomainConfigKey } from "../index.js";
import {
  S3_CONFIG,
  apisDomainConfigSchema,
  dynamodbDomainConfigSchema,
  snsDomainConfigSchema,
  s3DomainConfigSchema,
  sqsDomainConfigSchema,
} from "../native-domain-configs.js";

describe("DomainConfigs", () => {
  test("set and get with typed key", () => {
    interface TestConfig {
      value: number;
    }

    const key = createDomainConfigKey<TestConfig>("test");
    const configs = new DomainConfigs();
    configs.set(key, { value: 42 });

    expect(configs.get(key)).toEqual({ value: 42 });
  });

  test("get returns undefined for missing key", () => {
    const key = createDomainConfigKey<string>("missing");
    const configs = new DomainConfigs();

    expect(configs.get(key)).toBeUndefined();
  });

  test("require throws for missing key", () => {
    const key = createDomainConfigKey<string>("required");
    const configs = new DomainConfigs();

    expect(() => configs.require(key)).toThrow(
      'Required domain config missing: "required"',
    );
  });

  test("has returns correct boolean", () => {
    const key = createDomainConfigKey<string>("check");
    const configs = new DomainConfigs();

    expect(configs.has(key)).toBe(false);
    configs.set(key, "hello");
    expect(configs.has(key)).toBe(true);
  });

  test("keys lists all registered keys", () => {
    const keyA = createDomainConfigKey<string>("a");
    const keyB = createDomainConfigKey<number>("b");
    const configs = new DomainConfigs();

    configs.set(keyA, "val");
    configs.set(keyB, 99);

    expect(configs.keys().sort()).toEqual(["a", "b"]);
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
          removalPolicy: "RETAIN",
          stream: "NEW_AND_OLD_IMAGES",
        },
      },
    });

    expect(result.tables.users.removalPolicy).toBe("RETAIN");
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
    const configs = new DomainConfigs();

    expect(() =>
      configs.set(S3_CONFIG, {
        buckets: {},
        cleanupRoleArn: "",
      } as any),
    ).toThrow();
  });

  test("set() accepts valid value", () => {
    const configs = new DomainConfigs();

    configs.set(S3_CONFIG, { buckets: { bucket: { versioned: true } } });

    expect(configs.require(S3_CONFIG).buckets.bucket.versioned).toBe(true);
  });

  test("set() with schema-less key stores without validation", () => {
    const key = createDomainConfigKey<{ x: number }>("no-schema");
    const configs = new DomainConfigs();

    configs.set(key, { x: 42 });

    expect(configs.require(key).x).toBe(42);
  });
});
