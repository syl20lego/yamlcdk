export function formatCliError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const lines: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = error;
  let depth = 0;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message.trim() || current.name || "Unknown error";
    lines.push(depth === 0 ? message : `Caused by: ${message}`);

    if (current instanceof AggregateError && current.errors.length > 0) {
      for (const nested of current.errors) {
        const nestedMessage = formatCliError(nested);
        lines.push(`Caused by: ${nestedMessage}`);
      }
    }

    current = (current as Error & { cause?: unknown }).cause;
    depth += 1;
  }

  if (!lines.length) {
    return "Unknown error";
  }

  return lines.join("\n");
}
