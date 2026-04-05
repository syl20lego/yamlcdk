import { describe, expect, test } from "vitest";
import { DomainConfigs } from "../plugins/index.js";
import {
  eventDeclarationSchema,
  functionModelSchema,
  functionUrlConfigSchema,
  iamStatementSchema,
  parseServiceModel,
  providerConfigSchema,
  serviceModelSchema,
} from "../model.js";

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

  test("functionUrlConfigSchema validates auth, cors, and invoke mode", () => {
    const result = functionUrlConfigSchema.parse({
      authType: "NONE",
      invokeMode: "RESPONSE_STREAM",
      cors: {
        allowCredentials: true,
        allowedMethods: ["GET", "*"],
        allowOrigins: ["https://example.com"],
        maxAge: 300,
      },
    });

    expect(result.authType).toBe("NONE");
    expect(result.invokeMode).toBe("RESPONSE_STREAM");
    expect(result.cors?.allowedMethods).toEqual(["GET", "*"]);
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
    const domainConfigs = new DomainConfigs();
    const model = parseServiceModel({
      service: "demo",
      stackName: "demo-dev",
      provider: { region: "us-east-1", stage: "dev" },
      functions: {},
      iam: { statements: {} },
      domainConfigs,
    });

    expect(model.service).toBe("demo");
    expect(model.domainConfigs).toBe(domainConfigs);
  });
});
