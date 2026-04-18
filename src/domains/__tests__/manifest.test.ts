import { describe, expect, test } from "vitest";
import {
  domainManifest,
  orderedDomainManifest,
  nativeDomainsFromManifest,
} from "../index.js";

describe("domain manifest", () => {
  test("declares unique ids and plugin names", () => {
    const ids = domainManifest.map((descriptor) => descriptor.id);
    const names = domainManifest.map((descriptor) => descriptor.plugin.name);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  test("orders domains by explicit order metadata", () => {
    const orders = orderedDomainManifest.map((descriptor) => descriptor.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test("exposes functions as explicit event-binding producer", () => {
    const functionsDescriptor = orderedDomainManifest.find(
      (descriptor) => descriptor.id === "functions",
    );

    expect(functionsDescriptor).toBeDefined();
    expect(functionsDescriptor?.eventBindings?.produces).toBe(true);
    expect(functionsDescriptor?.eventBindings?.consumes).toBe(false);
  });

  test("native domain plugin list is derived from the manifest", () => {
    expect(
      nativeDomainsFromManifest.map((plugin) => plugin.name),
    ).toEqual(orderedDomainManifest.map((descriptor) => descriptor.plugin.name));
  });

  test("declares unique yamlcdk section registrations", () => {
    const registrations = orderedDomainManifest.flatMap((descriptor) =>
      (descriptor.yamlcdkSections ?? []).map(
        (entry) => `${entry.namespace}.${entry.key}`,
      ),
    );

    expect(new Set(registrations).size).toBe(registrations.length);
  });
});
