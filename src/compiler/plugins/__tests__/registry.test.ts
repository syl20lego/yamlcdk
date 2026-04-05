import { describe, expect, test } from "vitest";
import {
  DefinitionRegistry,
  DomainRegistry,
  PluginRegistry,
} from "../index.js";
import type { DefinitionPlugin, DomainPlugin } from "../index.js";
import type { ServiceModel } from "../../model.js";
import {
  createNativeDomainRegistry,
  nativeDomains,
} from "../../domains/index.js";

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

    expect(registry.all().map((plugin) => plugin.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("DefinitionRegistry", () => {
  test("resolves matching plugin", () => {
    const registry = new DefinitionRegistry();
    const plugin: DefinitionPlugin = {
      formatName: "test",
      canLoad: (filePath) => filePath.endsWith(".test"),
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

describe("PluginRegistry", () => {
  test("holds domain and definition registries", () => {
    const registry = new PluginRegistry();

    expect(registry.domains).toBeInstanceOf(DomainRegistry);
    expect(registry.definitions).toBeInstanceOf(DefinitionRegistry);
  });
});

describe("native domains", () => {
  test("all 7 native domains are declared", () => {
    expect(nativeDomains).toHaveLength(7);

    const names = nativeDomains.map((domain) => domain.name);
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
    const names = nativeDomains.map((domain) => domain.name);
    const functionsIndex = names.indexOf("functions");
    const s3Index = names.indexOf("s3");
    const dynamodbIndex = names.indexOf("dynamodb");
    const sqsIndex = names.indexOf("sqs");
    const snsIndex = names.indexOf("sns");
    const eventbridgeIndex = names.indexOf("eventbridge");
    const apisIndex = names.indexOf("apis");

    expect(s3Index).toBeLessThan(functionsIndex);
    expect(dynamodbIndex).toBeLessThan(functionsIndex);
    expect(sqsIndex).toBeLessThan(functionsIndex);
    expect(snsIndex).toBeLessThan(functionsIndex);

    expect(functionsIndex).toBeLessThan(eventbridgeIndex);
    expect(functionsIndex).toBeLessThan(apisIndex);
  });
});
