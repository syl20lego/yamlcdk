/**
 * Template inspection, row collection, and domain contribution merging.
 *
 * This module turns a synthesized CloudFormation template + optional
 * domain contributions into flat {@link ValidationReportRow} arrays.
 * It knows nothing about rendering or output format.
 */

import type { ServiceModel } from "../compiler/model.js";
import type {
  DomainValidationContribution,
  ValidationReportSection,
  ValidationReportStatus,
} from "../compiler/plugins/index.js";

export interface ValidationReportRow {
  readonly stage: string;
  readonly region: string;
  readonly section: ValidationReportSection;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly logicalId: string;
  readonly fqn: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly status: ValidationReportStatus;
}

export interface TemplateSection {
  readonly [logicalId: string]: unknown;
}

export interface TemplateShape {
  readonly Resources?: TemplateSection;
  readonly Parameters?: TemplateSection;
  readonly Outputs?: TemplateSection;
  readonly Rules?: TemplateSection;
  readonly Conditions?: TemplateSection;
}

type JsonRecord = Record<string, unknown>;

const SECTION_ORDER: readonly ValidationReportSection[] = [
  "Resources",
  "Parameters",
  "Outputs",
  "Rules",
  "Conditions",
];

const RESOURCE_NAME_KEYS = [
  "FunctionName",
  "BucketName",
  "TableName",
  "QueueName",
  "TopicName",
  "RoleName",
  "RuleName",
  "ApiName",
  "RestApiName",
  "Name",
] as const;

const RESOURCE_ARN_KEYS = [
  "Arn",
  "FunctionArn",
  "BucketArn",
  "TableArn",
  "QueueArn",
  "TopicArn",
  "RoleArn",
] as const;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asSection(value: unknown): readonly [string, unknown][] {
  return Object.entries(asRecord(value)).sort(([a], [b]) => a.localeCompare(b));
}

function sectionTypeLabel(section: ValidationReportSection, value: unknown): string {
  if (section === "Resources") {
    const typeValue = asRecord(value).Type;
    return typeof typeValue === "string" ? typeValue : "Resource";
  }
  return section.slice(0, -1);
}

function inferResourceName(logicalId: string, value: unknown): string {
  const properties = asRecord(asRecord(value).Properties);
  for (const key of RESOURCE_NAME_KEYS) {
    const candidate = properties[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return logicalId;
}

function inferResourceDescription(resourceType: string): string {
  if (resourceType.startsWith("AWS::Lambda::")) return "Lambda resource";
  if (resourceType.startsWith("AWS::ApiGateway::")) return "API Gateway resource";
  if (resourceType.startsWith("AWS::ApiGatewayV2::")) return "HTTP API resource";
  if (resourceType.startsWith("AWS::S3::")) return "S3 resource";
  if (resourceType.startsWith("AWS::DynamoDB::")) return "DynamoDB resource";
  if (resourceType.startsWith("AWS::SQS::")) return "SQS resource";
  if (resourceType.startsWith("AWS::SNS::")) return "SNS resource";
  if (resourceType.startsWith("AWS::Events::")) return "EventBridge resource";
  return `${resourceType} resource`;
}

function inferFqn(
  logicalId: string,
  section: ValidationReportSection,
  value: unknown,
): string {
  if (section !== "Resources") {
    return logicalId;
  }
  const properties = asRecord(asRecord(value).Properties);
  const fqnParts = [logicalId];

  for (const key of RESOURCE_NAME_KEYS) {
    const candidate = properties[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      fqnParts.push(candidate);
      break;
    }
  }

  for (const key of RESOURCE_ARN_KEYS) {
    const candidate = properties[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      fqnParts.push(candidate);
      break;
    }
  }

  return [...new Set(fqnParts)].join(" | ");
}

function collectBaseValidationRows(
  model: ServiceModel,
  template: TemplateShape,
): ValidationReportRow[] {
  const rows: ValidationReportRow[] = [];

  for (const section of SECTION_ORDER) {
    for (const [logicalId, value] of asSection(template[section])) {
      const type = sectionTypeLabel(section, value);
      const description =
        section === "Resources"
          ? inferResourceDescription(type)
          : `${section.slice(0, -1)} definition`;
      const params = asRecord(value);

      rows.push({
        stage: model.provider.stage,
        region: model.provider.region,
        section,
        type,
        name:
          section === "Resources"
            ? inferResourceName(logicalId, value)
            : logicalId,
        description,
        logicalId,
        fqn: inferFqn(logicalId, section, value),
        params: Object.keys(params).length > 0 ? params : undefined,
        status: "valid",
      });
    }
  }

  return rows;
}

function mergeRecords(
  base: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!base && !patch) return undefined;
  return { ...(base ?? {}), ...(patch ?? {}) };
}

function rowSortOrder(section: ValidationReportSection): number {
  return SECTION_ORDER.indexOf(section);
}

function findRowIndex(
  rows: readonly ValidationReportRow[],
  contribution: DomainValidationContribution,
): number {
  const section = contribution.section ?? "Resources";
  if (contribution.logicalId) {
    return rows.findIndex(
      (row) => row.section === section && row.logicalId === contribution.logicalId,
    );
  }
  if (contribution.name) {
    return rows.findIndex(
      (row) => row.section === section && row.name === contribution.name,
    );
  }
  return -1;
}

function applyDomainValidationContributions(
  rows: readonly ValidationReportRow[],
  model: ServiceModel,
  contributions: readonly DomainValidationContribution[],
): ValidationReportRow[] {
  const merged = [...rows];

  for (const contribution of contributions) {
    const section = contribution.section ?? "Resources";
    const rowIndex = findRowIndex(merged, contribution);

    if (rowIndex >= 0) {
      const row = merged[rowIndex];
      merged[rowIndex] = {
        ...row,
        name: contribution.name ?? row.name,
        description: contribution.description ?? row.description,
        params: mergeRecords(row.params, contribution.params),
        properties: mergeRecords(row.properties, contribution.properties),
        status: contribution.status ?? row.status,
      };
      continue;
    }

    const logicalId =
      contribution.logicalId ?? contribution.name ?? "domain-contribution";
    merged.push({
      stage: model.provider.stage,
      region: model.provider.region,
      section,
      type: "DomainMetadata",
      name: contribution.name ?? logicalId,
      description: contribution.description ?? "Domain validation metadata",
      logicalId,
      fqn: logicalId,
      params: contribution.params,
      properties: contribution.properties,
      status: contribution.status ?? "derived",
    });
  }

  return merged.sort((a, b) => {
    const sectionDelta = rowSortOrder(a.section) - rowSortOrder(b.section);
    if (sectionDelta !== 0) return sectionDelta;
    const logicalIdDelta = a.logicalId.localeCompare(b.logicalId);
    if (logicalIdDelta !== 0) return logicalIdDelta;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Extract flat validation rows from a raw CloudFormation template shape,
 * optionally enriched with domain contributions.
 */
export function buildValidationReportRowsFromTemplate(
  model: ServiceModel,
  template: TemplateShape,
  contributions: readonly DomainValidationContribution[] = [],
): ValidationReportRow[] {
  const baseRows = collectBaseValidationRows(model, template);
  return applyDomainValidationContributions(baseRows, model, contributions);
}
