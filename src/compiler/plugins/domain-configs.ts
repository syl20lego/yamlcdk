/**
 * Type-safe, extensible store for domain-specific configuration.
 *
 * Each domain plugin declares a typed key with an optional Zod schema.
 * Definition plugins populate the store during model adaptation.
 * Domain plugins retrieve their own slice at compilation time.
 *
 * When a schema is attached to the key, `set()` validates the
 * value at runtime before storing — eliminating unsafe `as T` casts.
 */

import type { z } from "zod";

/**
 * Branded key that carries its value type in the generic parameter
 * and an optional Zod schema for runtime validation.
 *
 * Create keys with {@link createDomainConfigKey}.
 */
export interface DomainConfigKey<T> {
  readonly id: string;
  /** Optional Zod schema — when present, `DomainConfigs.set()` validates. */
  readonly schema?: z.ZodType<T>;
}

/** Create a typed domain config key, optionally with a Zod schema. */
export function createDomainConfigKey<T>(
  id: string,
  schema?: z.ZodType<T>,
): DomainConfigKey<T> {
  return schema ? { id, schema } : ({ id } as DomainConfigKey<T>);
}

/**
 * Runtime store for domain configuration slices.
 *
 * When a key carries a Zod schema, `set()` validates the value
 * before storing.  Values that passed validation are returned
 * as-is from `get()` / `require()`.
 */
export class DomainConfigs {
  private readonly store = new Map<string, unknown>();

  set<T>(key: DomainConfigKey<T>, value: T): void {
    const validated = key.schema ? key.schema.parse(value) : value;
    this.store.set(key.id, validated);
  }

  get<T>(key: DomainConfigKey<T>): T | undefined {
    return this.store.get(key.id) as T | undefined;
  }

  require<T>(key: DomainConfigKey<T>): T {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(`Required domain config missing: "${key.id}"`);
    }
    return value;
  }

  has(key: DomainConfigKey<unknown>): boolean {
    return this.store.has(key.id);
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}
