const MANAGED_REF_PREFIX = "ref:";

/**
 * Accept both `<name>` and `ref:<name>` and return the canonical resource name.
 */
export function normalizeManagedResourceRef(value: string): string {
  if (!value.startsWith(MANAGED_REF_PREFIX)) {
    return value;
  }

  const name = value.slice(MANAGED_REF_PREFIX.length).trim();
  if (!name) {
    throw new Error(
      `Invalid managed resource reference "${value}". Use "<name>" or "ref:<name>".`,
    );
  }
  return name;
}

/**
 * Resolve a managed resource reference from an IAM resource string.
 *
 * - `ref:<name>` always resolves to `<name>`
 * - bare `<name>` resolves only when it matches an in-memory managed resource key
 */
export function resolveManagedResourceRef(
  value: string,
  refs: Record<string, unknown>,
): string | undefined {
  if (value.startsWith(MANAGED_REF_PREFIX)) {
    return normalizeManagedResourceRef(value);
  }

  return value in refs ? value : undefined;
}

