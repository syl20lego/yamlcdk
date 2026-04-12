/**
 * Validation report rendering — text tables and JSON output.
 *
 * This module is purely presentation. It consumes the structured
 * {@link ValidationReport} and produces human- or machine-readable output.
 */

import type {
  ValidationReport,
  ValidationOverviewRow,
  ValidationDetailTable,
  ValidationSectionTable,
} from "./validate-report.js";

type RowRecord = Record<string, unknown>;

interface RenderColumn {
  readonly key: string;
  readonly label: string;
  readonly maxWidth?: number;
}

const OVERVIEW_COLUMNS: readonly RenderColumn[] = [
  { key: "stage", label: "Stage", maxWidth: 12 },
  { key: "region", label: "Region", maxWidth: 14 },
  { key: "section", label: "Section", maxWidth: 11 },
  { key: "type", label: "Type", maxWidth: 32 },
  { key: "name", label: "Name", maxWidth: 30 },
  { key: "status", label: "Status", maxWidth: 14 },
];

const NON_RESOURCE_COLUMNS: readonly RenderColumn[] = [
  { key: "name", label: "Name", maxWidth: 34 },
  { key: "type", label: "Type", maxWidth: 30 },
  { key: "status", label: "Status", maxWidth: 12 },
  { key: "summary", label: "Summary", maxWidth: 56 },
];

const DEFAULT_COLUMN_MAX_WIDTH = 48;

function toMultilineString(value: unknown): string {
  if (value === undefined) return "-";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function wrapByWidth(value: string, width: number): string[] {
  if (!value.length) return [""];
  if (width <= 0) return [value];
  const segments: string[] = [];
  for (let index = 0; index < value.length; index += width) {
    segments.push(value.slice(index, index + width));
  }
  return segments;
}

function cellLines(value: unknown, width: number): string[] {
  return toMultilineString(value)
    .split("\n")
    .flatMap((line) => wrapByWidth(line, width));
}

function resolveColumnWidth(
  rows: readonly RowRecord[],
  column: RenderColumn,
): number {
  const maxRawWidth = rows.reduce((maxWidth, row) => {
    const raw = toMultilineString(row[column.key]);
    const lineWidth = raw.split("\n").reduce((lineMax, line) => {
      return Math.max(lineMax, line.length);
    }, 0);
    return Math.max(maxWidth, lineWidth);
  }, column.label.length);

  return Math.min(maxRawWidth, column.maxWidth ?? DEFAULT_COLUMN_MAX_WIDTH);
}

function renderRow(lines: readonly string[], widths: readonly number[]): string {
  return lines
    .map((line, index) => line.padEnd(widths[index], " "))
    .join(" | ");
}

function renderTable(
  rows: readonly RowRecord[],
  columns: readonly RenderColumn[],
): string {
  if (!rows.length) {
    return "(none)";
  }

  const widths = columns.map((column) => resolveColumnWidth(rows, column));
  const header = renderRow(
    columns.map((column) => column.label),
    widths,
  );
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  const body: string[] = [];

  for (const row of rows) {
    const allCellLines = columns.map((column, index) =>
      cellLines(row[column.key], widths[index]),
    );
    const rowHeight = allCellLines.reduce(
      (maxHeight, current) => Math.max(maxHeight, current.length),
      1,
    );

    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      body.push(
        renderRow(
          allCellLines.map((lineSet) => lineSet[lineIndex] ?? ""),
          widths,
        ),
      );
    }
  }

  return [header, separator, ...body, separator].join("\n");
}

function toRenderColumns(columnKeys: readonly string[]): RenderColumn[] {
  return columnKeys.map((key) => ({
    key,
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
  }));
}

function summarizePayload(value: unknown): string {
  if (value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

/** Render the validation report as human-readable text tables. */
export function renderValidationReportText(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push("Validation report (overview):");
  lines.push(
    renderTable(
      report.overviewRows.map((row) => ({ ...row })),
      OVERVIEW_COLUMNS,
    ),
  );

  for (const sectionTable of report.nonResourceSectionTables) {
    lines.push("");
    lines.push(`${sectionTable.title}:`);
    lines.push(
      renderTable(
        sectionTable.rows,
        toRenderColumns(sectionTable.columns),
      ),
    );
  }

  for (const detailTable of report.resourceDetailTables) {
    lines.push("");
    lines.push(`${detailTable.title}:`);
    lines.push(
      renderTable(detailTable.rows, toRenderColumns(detailTable.columns)),
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Render the validation report as machine-readable JSON. */
export function renderValidationReportJson(report: ValidationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Build non-resource section table rows (Parameters, Outputs, etc.).
 * Exported for use by the report builder.
 */
export function buildNonResourceSectionRows(
  rows: readonly { name: string; type: string; status: string; params?: unknown }[],
): RowRecord[] {
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    status: row.status,
    summary: summarizePayload(row.params),
  }));
}

export { NON_RESOURCE_COLUMNS };
