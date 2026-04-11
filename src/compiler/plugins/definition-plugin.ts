/**
 * Definition plugin contract.
 *
 * A definition plugin translates a specific file format
 * (yamlcdk.yml, serverless.yml, cloudformation.yml, …) into
 * the canonical {@link ServiceModel}.
 */

import type { ServiceModel } from "../model.js";

export interface DefinitionPluginLoadOptions {
  /** Values used by `${opt:...}` variable resolution. */
  opt?: Record<string, unknown>;
}

/**
 * Contract for a definition plugin.
 *
 * Lifecycle:
 *  1. `canLoad` — fast check (typically file extension / header).
 *  2. `load` — parse, validate, and adapt the file into a ServiceModel.
 *  3. `generateStarter` (optional) — produce starter config for `init`.
 */
export interface DefinitionPlugin {
  /** Human-readable format name (e.g. `"yamlcdk"`, `"serverless"`). */
  readonly formatName: string;

  /** Return `true` if this plugin can handle the given file path. */
  canLoad(filePath: string): boolean;

  /**
   * Parse, validate, and adapt the source file into a
   * canonical {@link ServiceModel}.
   *
   * Must throw with a clear message on validation failure.
   */
  load(filePath: string, options?: DefinitionPluginLoadOptions): ServiceModel;

  /**
   * Generate starter config file content.
   * Used by the `init` command.
   */
  generateStarter?(): string;
}
