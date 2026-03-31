/**
 * CloudFormation YAML parsing with intrinsic function support.
 *
 * CloudFormation templates use custom YAML tags (!Ref, !GetAtt, etc.)
 * that require a custom js-yaml schema to parse correctly.
 * Values are parsed into their long-form equivalents
 * (e.g. `!Ref X` → `{ Ref: "X" }`).
 */

import yaml from "js-yaml";

// ─── Intrinsic function types ───────────────────────────────

export interface CfnRef {
  Ref: string;
}

export interface CfnGetAtt {
  "Fn::GetAtt": [string, string];
}

// ─── Type guards ────────────────────────────────────────────

export function isCfnRef(value: unknown): value is CfnRef {
  return value !== null && typeof value === "object" && "Ref" in value;
}

export function isCfnGetAtt(value: unknown): value is CfnGetAtt {
  return (
    value !== null && typeof value === "object" && "Fn::GetAtt" in value
  );
}

/**
 * Extract the logical ID from a Ref or GetAtt value.
 * Returns undefined for non-intrinsic values.
 */
export function resolveLogicalId(value: unknown): string | undefined {
  if (isCfnRef(value)) return value.Ref;
  if (isCfnGetAtt(value)) return value["Fn::GetAtt"][0];
  return undefined;
}

// ─── Custom YAML types ─────────────────────────────────────

const cfnScalarTypes = [
  new yaml.Type("!Ref", {
    kind: "scalar",
    construct: (data: string): CfnRef => ({ Ref: data }),
  }),
  new yaml.Type("!GetAtt", {
    kind: "scalar",
    construct: (data: string): CfnGetAtt => ({
      "Fn::GetAtt": data.split(".") as [string, string],
    }),
  }),
  new yaml.Type("!Sub", {
    kind: "scalar",
    construct: (data: string) => ({ "Fn::Sub": data }),
  }),
  new yaml.Type("!Condition", {
    kind: "scalar",
    construct: (data: string) => ({ Condition: data }),
  }),
  new yaml.Type("!ImportValue", {
    kind: "scalar",
    construct: (data: string) => ({ "Fn::ImportValue": data }),
  }),
  new yaml.Type("!Base64", {
    kind: "scalar",
    construct: (data: string) => ({ "Fn::Base64": data }),
  }),
  new yaml.Type("!GetAZs", {
    kind: "scalar",
    construct: (data: string) => ({ "Fn::GetAZs": data }),
  }),
];

const cfnSequenceTypes = [
  new yaml.Type("!GetAtt", {
    kind: "sequence",
    construct: (data: string[]): CfnGetAtt => ({
      "Fn::GetAtt": data as [string, string],
    }),
  }),
  new yaml.Type("!Sub", {
    kind: "sequence",
    construct: (data: unknown[]) => ({
      "Fn::Sub": data as [string, Record<string, unknown>],
    }),
  }),
  new yaml.Type("!Join", {
    kind: "sequence",
    construct: (data: unknown[]) => ({
      "Fn::Join": data as [string, unknown[]],
    }),
  }),
  new yaml.Type("!Select", {
    kind: "sequence",
    construct: (data: unknown[]) => ({
      "Fn::Select": data as [number, unknown[]],
    }),
  }),
  new yaml.Type("!If", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::If": data }),
  }),
  new yaml.Type("!Equals", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::Equals": data }),
  }),
  new yaml.Type("!And", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::And": data }),
  }),
  new yaml.Type("!Or", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::Or": data }),
  }),
  new yaml.Type("!Not", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::Not": data }),
  }),
  new yaml.Type("!FindInMap", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::FindInMap": data }),
  }),
  new yaml.Type("!Split", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::Split": data }),
  }),
  new yaml.Type("!Cidr", {
    kind: "sequence",
    construct: (data: unknown[]) => ({ "Fn::Cidr": data }),
  }),
];

/** Custom YAML schema that handles CloudFormation intrinsic functions. */
export const CFN_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  ...cfnScalarTypes,
  ...cfnSequenceTypes,
]);

/** Parse a CloudFormation YAML template string. */
export function parseCfnYaml(content: string): unknown {
  return yaml.load(content, { schema: CFN_YAML_SCHEMA });
}
