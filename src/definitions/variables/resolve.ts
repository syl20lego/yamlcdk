import fs from "node:fs";
import path from "node:path";

const SUPPORTED_VARIABLE_SOURCES = new Set(["self", "opt", "sls", "aws", "file", "env"]);

type VariableOutcome =
  | { type: "value"; value: unknown }
  | { type: "skip" }
  | { type: "missing" };

interface TemplateTextPart {
  type: "text";
  value: string;
}

interface TemplateExpressionPart {
  type: "expression";
  value: string;
}

type TemplatePart = TemplateTextPart | TemplateExpressionPart;

interface ParsedVariableToken {
  source: string;
  address: string;
  filePathExpression?: string;
}

export interface ResolveDefinitionVariablesOptions {
  entryFilePath?: string;
  parseContent: (content: string, filePath: string) => unknown;
  opt?: Record<string, unknown>;
  stage?: string;
}

function splitTemplateParts(value: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("${", cursor);
    if (start === -1) {
      if (cursor < value.length) {
        parts.push({ type: "text", value: value.slice(cursor) });
      }
      break;
    }

    if (start > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, start) });
    }

    let index = start + 2;
    let depth = 1;
    while (index < value.length && depth > 0) {
      if (value.startsWith("${", index)) {
        depth += 1;
        index += 2;
        continue;
      }
      if (value[index] === "}") {
        depth -= 1;
        index += 1;
        continue;
      }
      index += 1;
    }

    if (depth !== 0) {
      parts.push({ type: "text", value: value.slice(start) });
      break;
    }

    parts.push({
      type: "expression",
      value: value.slice(start + 2, index - 1),
    });
    cursor = index;
  }

  return parts;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let nestedVariableDepth = 0;
  let parenthesesDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!quote && value.startsWith("${", index)) {
      nestedVariableDepth += 1;
      current += "${";
      index += 1;
      continue;
    }

    if (char === "}" && nestedVariableDepth > 0 && !quote) {
      nestedVariableDepth -= 1;
      current += char;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      current += char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      current += char;
      continue;
    }

    if (!quote && nestedVariableDepth === 0) {
      if (char === "(") {
        parenthesesDepth += 1;
      } else if (char === ")" && parenthesesDepth > 0) {
        parenthesesDepth -= 1;
      }
    }

    if (
      char === separator &&
      !quote &&
      nestedVariableDepth === 0 &&
      parenthesesDepth === 0
    ) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function findTopLevelCharacter(value: string, target: string): number {
  let quote: "'" | '"' | undefined;
  let nestedVariableDepth = 0;
  let parenthesesDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!quote && value.startsWith("${", index)) {
      nestedVariableDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}" && nestedVariableDepth > 0 && !quote) {
      nestedVariableDepth -= 1;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      continue;
    }

    if (!quote && nestedVariableDepth === 0) {
      if (char === "(") {
        parenthesesDepth += 1;
        continue;
      }
      if (char === ")" && parenthesesDepth > 0) {
        parenthesesDepth -= 1;
        continue;
      }
    }

    if (
      char === target &&
      !quote &&
      nestedVariableDepth === 0 &&
      parenthesesDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function parseLiteralVariableToken(token: string): unknown | undefined {
  if (
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith('"') && token.endsWith('"'))
  ) {
    return token.slice(1, -1);
  }
  if (/^-?\d+$/.test(token)) return Number(token);
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  return undefined;
}

function getPathValue(root: unknown, dottedPath: string): unknown {
  const segments = dottedPath.split(".").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseVariableToken(token: string): ParsedVariableToken | undefined {
  const delimiterIndex = findTopLevelCharacter(token, ":");
  if (delimiterIndex === -1) return undefined;

  const sourceToken = token.slice(0, delimiterIndex).trim();
  const address = token.slice(delimiterIndex + 1).trim();

  const fileMatch = /^file\((.*)\)$/i.exec(sourceToken);
  if (fileMatch) {
    return {
      source: "file",
      address,
      filePathExpression: fileMatch[1].trim(),
    };
  }

  return {
    source: sourceToken,
    address,
  };
}

function toCamelCaseOptionName(value: string): string {
  return value.replace(/-([a-zA-Z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function toKebabCaseOptionName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function resolveOptVariableValue(
  optionSource: Record<string, unknown> | undefined,
  address: string,
): unknown {
  if (!optionSource) return undefined;

  const key = address.trim();
  if (!key) return undefined;

  const candidates = [
    key,
    toCamelCaseOptionName(key),
    toKebabCaseOptionName(key),
  ];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(optionSource, candidate)) {
      return optionSource[candidate];
    }
  }

  return undefined;
}

function toScalarString(value: unknown, description: string): string {
  if (value !== null && typeof value === "object") {
    throw new Error(`${description} must resolve to a scalar value.`);
  }
  return String(value ?? "");
}

export function parseDotEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key) continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadDotEnvFiles(
  entryFilePath: string,
  stage: string | undefined,
): void {
  const dir = path.dirname(entryFilePath);
  // Load in priority order (highest first) so earlier values stick
  const files: string[] = [];
  if (stage) {
    files.push(path.join(dir, `.env.${stage}`));
  }
  files.push(path.join(dir, ".env"));

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const vars = parseDotEnvFile(content);
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function resolveDefinitionVariables(
  input: unknown,
  options: ResolveDefinitionVariablesOptions,
): unknown {
  const resolvedFileCache = new Map<string, unknown>();
  const inProgressFiles = new Set<string>();
  const entryFilePath = path.resolve(
    options.entryFilePath ?? path.join(process.cwd(), "definition.yml"),
  );

  loadDotEnvFiles(entryFilePath, options.stage);

  const resolveDocument = (
    root: unknown,
    currentFilePath: string,
    rootResolvePath?: (dottedPath: string) => unknown,
  ): unknown => {
    const pathCache = new Map<string, unknown>();
    const inProgressPaths = new Set<string>();

    const resolvePath = (dottedPath: string): unknown => {
      if (pathCache.has(dottedPath)) return pathCache.get(dottedPath);
      if (inProgressPaths.has(dottedPath)) {
        throw new Error(
          `Circular variable reference detected at "${dottedPath}" in "${currentFilePath}".`,
        );
      }

      inProgressPaths.add(dottedPath);
      const rawValue = getPathValue(root, dottedPath);
      let resolvedValue = resolveNode(rawValue, dottedPath);

      if (resolvedValue === undefined && rootResolvePath) {
        resolvedValue = rootResolvePath(dottedPath);
      }

      if (resolvedValue === undefined && dottedPath.includes(".")) {
        const segments = dottedPath.split(".").filter(Boolean);
        for (let splitIndex = segments.length - 1; splitIndex > 0; splitIndex -= 1) {
          const prefixPath = segments.slice(0, splitIndex).join(".");
          const suffixPath = segments.slice(splitIndex).join(".");
          const prefixValue = resolvePath(prefixPath);
          if (prefixValue === undefined) continue;
          const suffixValue = getPathValue(prefixValue, suffixPath);
          if (suffixValue === undefined) continue;
          resolvedValue = resolveNode(suffixValue, dottedPath);
          break;
        }
      }

      inProgressPaths.delete(dottedPath);
      pathCache.set(dottedPath, resolvedValue);
      return resolvedValue;
    };

    const resolveFileDocument = (absoluteFilePath: string): unknown => {
      const normalizedPath = path.resolve(absoluteFilePath);
      if (resolvedFileCache.has(normalizedPath)) {
        return resolvedFileCache.get(normalizedPath);
      }
      if (inProgressFiles.has(normalizedPath)) {
        throw new Error(
          `Circular file variable reference detected at "${normalizedPath}".`,
        );
      }

      inProgressFiles.add(normalizedPath);
      try {
        const content = fs.readFileSync(normalizedPath, "utf8");
        const parsed = options.parseContent(content, normalizedPath);
        const resolved = resolveDocument(
          parsed,
          normalizedPath,
          rootResolvePath ?? resolvePath,
        );
        resolvedFileCache.set(normalizedPath, resolved);
        return resolved;
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === "ENOENT") {
          return undefined;
        }
        if (error instanceof Error) {
          throw new Error(
            `Failed to load variable file "${normalizedPath}": ${error.message}`,
          );
        }
        throw error;
      } finally {
        inProgressFiles.delete(normalizedPath);
      }
    };

    const resolveExpressionTemplate = (
      expression: string,
      currentPath: string,
    ): VariableOutcome => {
      const parts = splitTemplateParts(expression);
      const hasNestedExpressions = parts.some((part) => part.type === "expression");
      if (!hasNestedExpressions) return { type: "value", value: expression };

      let result = "";
      for (const part of parts) {
        if (part.type === "text") {
          result += part.value;
          continue;
        }

        const nestedOutcome = resolveVariableExpression(part.value, currentPath);
        if (nestedOutcome.type === "missing") return nestedOutcome;
        if (nestedOutcome.type === "skip") {
          result += `\${${part.value}}`;
          continue;
        }
        result += toScalarString(
          nestedOutcome.value,
          `Nested variable "\${${part.value}}" at "${currentPath}"`,
        );
      }

      return { type: "value", value: result };
    };

    const resolveSpecialVariable = (
      source: string,
      address: string,
      currentPath: string,
      filePathExpression?: string,
    ): VariableOutcome => {
      if (!SUPPORTED_VARIABLE_SOURCES.has(source)) {
        return { type: "skip" };
      }

      if (source === "self") {
        return { type: "value", value: resolvePath(address) };
      }

      if (source === "opt") {
        const optionValue = resolveOptVariableValue(options.opt, address);
        if (optionValue === undefined) return { type: "missing" };

        if (typeof optionValue === "string") {
          const parsedLiteral = parseLiteralVariableToken(optionValue);
          if (parsedLiteral !== undefined) {
            return { type: "value", value: parsedLiteral };
          }
        }

        return { type: "value", value: optionValue };
      }

      if (source === "sls") {
        if (address === "stage") {
          return {
            type: "value",
            value: resolvePath("provider.stage") ?? "dev",
          };
        }
        if (address === "service") {
          const service = resolvePath("service");
          if (typeof service === "string") return { type: "value", value: service };
          if (
            service &&
            typeof service === "object" &&
            typeof (service as Record<string, unknown>).name === "string"
          ) {
            return {
              type: "value",
              value: (service as Record<string, unknown>).name,
            };
          }
          return { type: "missing" };
        }
        return { type: "skip" };
      }

      if (source === "aws") {
        if (address === "region") {
          return {
            type: "value",
            value:
              resolvePath("provider.region") ??
              process.env.AWS_REGION ??
              "us-east-1",
          };
        }
        if (address === "accountId") {
          const accountId =
            resolvePath("provider.account") ??
            process.env.AWS_ACCOUNT_ID ??
            process.env.CDK_DEFAULT_ACCOUNT;
          return accountId !== undefined
            ? { type: "value", value: accountId }
            : { type: "missing" };
        }
        return { type: "skip" };
      }

      if (source === "env") {
        const envValue = process.env[address];
        return envValue !== undefined
          ? { type: "value", value: envValue }
          : { type: "missing" };
      }

      if (source === "file") {
        if (!filePathExpression) return { type: "missing" };

        const resolvedFileExpression = resolveExpressionTemplate(
          filePathExpression,
          currentPath,
        );
        if (resolvedFileExpression.type !== "value") return resolvedFileExpression;

        const resolvedSelectorExpression = resolveExpressionTemplate(
          address,
          currentPath,
        );
        if (resolvedSelectorExpression.type !== "value") {
          return resolvedSelectorExpression;
        }

        const relativeFilePath = toScalarString(
          resolvedFileExpression.value,
          `file(...) path at "${currentPath}"`,
        );
        const selectorPath = toScalarString(
          resolvedSelectorExpression.value,
          `file(...):selector at "${currentPath}"`,
        ).trim();

        const absoluteFilePath = path.resolve(
          path.dirname(currentFilePath),
          relativeFilePath,
        );
        const resolvedFile = resolveFileDocument(absoluteFilePath);
        if (resolvedFile === undefined) return { type: "missing" };
        if (!selectorPath) return { type: "missing" };

        const selected = getPathValue(resolvedFile, selectorPath);
        return selected === undefined
          ? { type: "missing" }
          : { type: "value", value: selected };
      }

      return { type: "skip" };
    };

    const resolveVariableExpression = (
      expression: string,
      currentPath: string,
    ): VariableOutcome => {
      const prepared = resolveExpressionTemplate(expression, currentPath);
      if (prepared.type !== "value") return prepared;

      let sawSupportedSource = false;
      for (const alternative of splitTopLevel(
        String(prepared.value),
        ",",
      )) {
        const literal = parseLiteralVariableToken(alternative);
        if (literal !== undefined) return { type: "value", value: literal };

        const token = parseVariableToken(alternative);
        if (!token) continue;

        const outcome = resolveSpecialVariable(
          token.source,
          token.address,
          currentPath,
          token.filePathExpression,
        );

        if (SUPPORTED_VARIABLE_SOURCES.has(token.source)) {
          sawSupportedSource = true;
        }
        if (outcome.type === "value" && outcome.value !== undefined) return outcome;
        if (outcome.type === "skip") continue;
      }

      return sawSupportedSource ? { type: "missing" } : { type: "skip" };
    };

    const resolveString = (value: string, currentPath: string): unknown => {
      const parts = splitTemplateParts(value);
      if (
        parts.length === 1 &&
        parts[0].type === "expression" &&
        value.startsWith("${") &&
        value.endsWith("}")
      ) {
        const outcome = resolveVariableExpression(parts[0].value, currentPath);
        if (outcome.type === "value") return resolveNode(outcome.value, currentPath);
        if (outcome.type === "missing") {
          throw new Error(
            `Unable to resolve variable "${value}" at "${currentPath}" in "${currentFilePath}".`,
          );
        }
        return value;
      }

      let result = "";
      for (const part of parts) {
        if (part.type === "text") {
          result += part.value;
          continue;
        }

        const outcome = resolveVariableExpression(part.value, currentPath);
        if (outcome.type === "skip") {
          result += `\${${part.value}}`;
          continue;
        }
        if (outcome.type === "missing") {
          throw new Error(
            `Unable to resolve variable "\${${part.value}}" at "${currentPath}" in "${currentFilePath}".`,
          );
        }
        result += toScalarString(
          outcome.value,
          `Variable "\${${part.value}}" at "${currentPath}"`,
        );
      }

      return result;
    };

    const resolveNode = (value: unknown, currentPath: string): unknown => {
      if (typeof value === "string") {
        return resolveString(value, currentPath);
      }
      if (Array.isArray(value)) {
        return value.map((entry, index) =>
          resolveNode(entry, `${currentPath}[${index}]`),
        );
      }
      if (value && typeof value === "object") {
        const resolvedEntries = Object.entries(value as Record<string, unknown>)
          .map(([key, entry]) => [key, resolveNode(entry, `${currentPath}.${key}`)] as const)
          .filter(([, entry]) => entry !== null);
        return Object.fromEntries(resolvedEntries);
      }
      return value;
    };

    return resolveNode(root, "$");
  };

  return resolveDocument(input, entryFilePath);
}
