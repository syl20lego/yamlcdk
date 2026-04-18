import { describe, expect, test } from "vitest";
import {
  createNormalizedYamlcdkDomainSectionSchemas,
  createRawYamlcdkDomainSectionSchemas,
  normalizeYamlcdkDomainSections,
} from "../domain-schema-registry.js";

describe("domain schema registry", () => {
  test("builds raw section schemas from domain registrations", () => {
    const rawSections = createRawYamlcdkDomainSectionSchemas();

    expect(() =>
      rawSections.storage.parse({
        s3: {
          uploads: { versioned: true },
        },
        dynamodb: {},
      }),
    ).not.toThrow();

    expect(() =>
      rawSections.storage.parse({
        s3: {
          uploads: { versioned: "true" },
        },
      }),
    ).toThrow();
  });

  test("builds normalized section schemas with required registered keys", () => {
    const normalizedSections = createNormalizedYamlcdkDomainSectionSchemas();

    expect(() =>
      normalizedSections.messaging.parse({
        sqs: {},
        sns: {},
      }),
    ).not.toThrow();

    expect(() =>
      normalizedSections.messaging.parse({
        sqs: {},
      }),
    ).toThrow();
  });

  test("normalizes domain sections with registration defaults", () => {
    const normalized = normalizeYamlcdkDomainSections({});

    expect(Object.keys(normalized.storage).sort()).toEqual(["dynamodb", "s3"]);
    expect(Object.keys(normalized.messaging).sort()).toEqual(["sns", "sqs"]);
    expect(Object.keys(normalized.cdn).sort()).toEqual([
      "cachePolicies",
      "distributions",
      "originRequestPolicies",
    ]);
    expect(normalized.storage.s3).toEqual({});
    expect(normalized.messaging.sqs).toEqual({});
  });

  test("preserves explicit section values while defaulting missing ones", () => {
    const normalized = normalizeYamlcdkDomainSections({
      storage: {
        s3: {
          uploads: { versioned: true },
        },
      },
      messaging: {
        sns: {
          alerts: {
            displayName: "Alerts",
          },
        },
      },
    });

    expect(normalized.storage.s3).toEqual({
      uploads: { versioned: true },
    });
    expect(normalized.storage.dynamodb).toEqual({});
    expect(normalized.messaging.sns).toEqual({
      alerts: { displayName: "Alerts" },
    });
    expect(normalized.messaging.sqs).toEqual({});
  });
});
