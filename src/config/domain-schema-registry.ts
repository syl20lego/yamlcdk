import { z } from "zod";
import type {
  DomainYamlcdkSectionNamespace,
  DomainYamlcdkSectionRegistration,
} from "../domains/contracts.js";
import { orderedDomainManifest } from "../domains/manifest.js";

const yamlcdkSectionNamespaces = ["storage", "messaging", "cdn"] as const;

interface YamlcdkDomainSectionRegistry {
  readonly storage: readonly DomainYamlcdkSectionRegistration[];
  readonly messaging: readonly DomainYamlcdkSectionRegistration[];
  readonly cdn: readonly DomainYamlcdkSectionRegistration[];
}

export interface RawYamlcdkDomainSectionsInput {
  readonly storage?: unknown;
  readonly messaging?: unknown;
  readonly cdn?: unknown;
}

export interface NormalizedYamlcdkDomainSections {
  readonly storage: Record<string, unknown>;
  readonly messaging: Record<string, unknown>;
  readonly cdn: Record<string, unknown>;
}

function assertValidYamlcdkRegistration(
  registration: DomainYamlcdkSectionRegistration,
  descriptorId: string,
): void {
  if (registration.key.length === 0) {
    throw new Error(
      `Domain "${descriptorId}" declares an empty yamlcdk section key.`,
    );
  }
}

function collectYamlcdkSectionRegistry(): YamlcdkDomainSectionRegistry {
  const grouped: {
    [K in DomainYamlcdkSectionNamespace]: DomainYamlcdkSectionRegistration[];
  } = {
    storage: [],
    messaging: [],
    cdn: [],
  };
  const seen = new Set<string>();

  for (const descriptor of orderedDomainManifest) {
    for (const registration of descriptor.yamlcdkSections ?? []) {
      assertValidYamlcdkRegistration(registration, descriptor.id);

      const identity = `${registration.namespace}.${registration.key}`;
      if (seen.has(identity)) {
        throw new Error(`Duplicate yamlcdk section registration "${identity}".`);
      }
      seen.add(identity);
      grouped[registration.namespace].push(registration);
    }
  }

  return grouped;
}

const yamlcdkSectionRegistry = collectYamlcdkSectionRegistry();

function buildRawContainerSchema(
  namespace: DomainYamlcdkSectionNamespace,
): z.ZodOptional<z.ZodObject<Record<string, z.ZodTypeAny>>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const registration of yamlcdkSectionRegistry[namespace]) {
    shape[registration.key] = registration.schema.optional();
  }
  return z.object(shape).optional();
}

function buildNormalizedContainerSchema(
  namespace: DomainYamlcdkSectionNamespace,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const registration of yamlcdkSectionRegistry[namespace]) {
    shape[registration.key] = registration.schema;
  }
  return z.object(shape);
}

function readContainerValue(
  source: RawYamlcdkDomainSectionsInput,
  namespace: DomainYamlcdkSectionNamespace,
): Record<string, unknown> | undefined {
  const value = source[namespace];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Normalized yamlcdk section "${namespace}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function createRawYamlcdkDomainSectionSchemas(): {
  readonly storage: z.ZodOptional<z.ZodObject<Record<string, z.ZodTypeAny>>>;
  readonly messaging: z.ZodOptional<z.ZodObject<Record<string, z.ZodTypeAny>>>;
  readonly cdn: z.ZodOptional<z.ZodObject<Record<string, z.ZodTypeAny>>>;
} {
  return {
    storage: buildRawContainerSchema("storage"),
    messaging: buildRawContainerSchema("messaging"),
    cdn: buildRawContainerSchema("cdn"),
  };
}

export function createNormalizedYamlcdkDomainSectionSchemas(): {
  readonly storage: z.ZodObject<Record<string, z.ZodTypeAny>>;
  readonly messaging: z.ZodObject<Record<string, z.ZodTypeAny>>;
  readonly cdn: z.ZodObject<Record<string, z.ZodTypeAny>>;
} {
  return {
    storage: buildNormalizedContainerSchema("storage"),
    messaging: buildNormalizedContainerSchema("messaging"),
    cdn: buildNormalizedContainerSchema("cdn"),
  };
}

export function normalizeYamlcdkDomainSections(
  source: RawYamlcdkDomainSectionsInput,
): NormalizedYamlcdkDomainSections {
  const normalized: {
    [K in DomainYamlcdkSectionNamespace]: Record<string, unknown>;
  } = {
    storage: {},
    messaging: {},
    cdn: {},
  };

  for (const namespace of yamlcdkSectionNamespaces) {
    const container = readContainerValue(source, namespace);
    for (const registration of yamlcdkSectionRegistry[namespace]) {
      normalized[namespace][registration.key] =
        container?.[registration.key] ?? registration.createDefault();
    }
  }

  return normalized;
}
