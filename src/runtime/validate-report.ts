/**
 * Validation report — public API and report model types.
 *
 * Delegates extraction to {@link ./validate-extraction} and
 * rendering to {@link ./validate-renderer}.
 */

import { Template } from "aws-cdk-lib/assertions";
import type { ServiceModel } from "../compiler/model.js";
import type { ValidationReportSection, ValidationReportStatus } from "../compiler/plugins/index.js";
import type { ServiceStack } from "../compiler/stack-builder.js";
import {
  buildValidationReportRowsFromTemplate,
  type ValidationReportRow,
} from "./validate-extraction.js";

// ─── Report model types (shared by extraction + renderer) ───

type RowRecord = Record<string, unknown>;

export interface ValidationOverviewRow {
  readonly stage: string;
  readonly region: string;
  readonly section: ValidationReportSection;
  readonly type: string;
  readonly name: string;
  readonly status: ValidationReportStatus;
}

export interface ValidationDetailTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly RowRecord[];
}

export interface ValidationSectionTable {
  readonly title: string;
  readonly section: ValidationReportSection;
  readonly columns: readonly string[];
  readonly rows: readonly RowRecord[];
}

export interface ValidationReport {
  readonly overviewRows: readonly ValidationOverviewRow[];
  readonly resourceDetailTables: readonly ValidationDetailTable[];
  readonly nonResourceSectionTables: readonly ValidationSectionTable[];
}

// ─── Non-resource section helpers ───────────────────────────

const NON_RESOURCE_SECTIONS: readonly ValidationReportSection[] = [
  "Parameters",
  "Outputs",
  "Rules",
  "Conditions",
];

const NON_RESOURCE_COLUMN_KEYS: readonly string[] = [
  "name",
  "type",
  "status",
  "summary",
];

function summarizePayload(value: unknown): string {
  if (value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// ─── Report builders ────────────────────────────────────────

function buildOverviewRows(rows: readonly ValidationReportRow[]): ValidationOverviewRow[] {
  return rows.map((row) => ({
    stage: row.stage,
    region: row.region,
    section: row.section,
    type: row.type,
    name: row.name,
    status: row.status,
  }));
}

function buildResourceDetailTables(
  rows: readonly ValidationReportRow[],
): ValidationDetailTable[] {
  const enrichedRows = rows.filter(
    (row) =>
      row.section === "Resources" &&
      row.properties &&
      Object.keys(row.properties).length > 0,
  );

  const grouped = new Map<string, ValidationReportRow[]>();
  for (const row of enrichedRows) {
    const existing = grouped.get(row.type) ?? [];
    existing.push(row);
    grouped.set(row.type, existing);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resourceType, groupedRows]) => {
      const propertyColumns = new Set<string>();
      for (const row of groupedRows) {
        for (const key of Object.keys(row.properties ?? {})) {
          propertyColumns.add(key);
        }
      }

      const columns = [
        "name",
        "status",
        ...[...propertyColumns].sort((a, b) => a.localeCompare(b)),
      ];
      const detailRows = groupedRows.map((row) => ({
        name: row.name,
        status: row.status,
        ...(row.properties ?? {}),
      }));

      return {
        title: `${resourceType} details`,
        columns,
        rows: detailRows,
      };
    });
}

function buildNonResourceSectionTables(
  rows: readonly ValidationReportRow[],
): ValidationSectionTable[] {
  const tables: ValidationSectionTable[] = [];

  for (const section of NON_RESOURCE_SECTIONS) {
    const sectionRows = rows.filter((row) => row.section === section);
    if (!sectionRows.length) continue;

    tables.push({
      title: `${section} summary`,
      section,
      columns: [...NON_RESOURCE_COLUMN_KEYS],
      rows: sectionRows.map((row) => ({
        name: row.name,
        type: row.type,
        status: row.status,
        summary: summarizePayload(row.params),
      })),
    });
  }

  return tables;
}

function buildValidationReportFromRows(
  rows: readonly ValidationReportRow[],
): ValidationReport {
  return {
    overviewRows: buildOverviewRows(rows),
    resourceDetailTables: buildResourceDetailTables(rows),
    nonResourceSectionTables: buildNonResourceSectionTables(rows),
  };
}

// ─── Public API ─────────────────────────────────────────────

export function buildValidationReportRows(
  model: ServiceModel,
  stack: ServiceStack,
): ValidationReportRow[] {
  const template = Template.fromStack(stack).toJSON() as Record<string, unknown>;
  return buildValidationReportRowsFromTemplate(
    model,
    template,
    stack.validationContributions,
  );
}

export function buildValidationReport(
  model: ServiceModel,
  stack: ServiceStack,
): ValidationReport {
  return buildValidationReportFromRows(buildValidationReportRows(model, stack));
}

// Re-export extraction types and renderer functions
export { type ValidationReportRow, buildValidationReportRowsFromTemplate } from "./validate-extraction.js";
export { renderValidationReportText, renderValidationReportJson } from "./validate-renderer.js";

