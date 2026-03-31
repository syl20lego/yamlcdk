/**
 * Plugin registries for domain and definition plugins.
 *
 * Native/bundled plugins are registered at startup.
 * External plugin loading will be added in a future phase.
 */

import type { DomainPlugin } from "./domain-plugin.js";
import type { DefinitionPlugin } from "./definition-plugin.js";

/** Registry for domain plugins with duplicate-name protection. */
export class DomainRegistry {
  private readonly plugins = new Map<string, DomainPlugin>();

  register(plugin: DomainPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(
        `Domain plugin "${plugin.name}" is already registered.`,
      );
    }
    this.plugins.set(plugin.name, plugin);
  }

  get(name: string): DomainPlugin | undefined {
    return this.plugins.get(name);
  }

  /** All registered plugins in insertion order. */
  all(): readonly DomainPlugin[] {
    return [...this.plugins.values()];
  }
}

/** Registry for definition plugins with duplicate-format protection. */
export class DefinitionRegistry {
  private readonly plugins: DefinitionPlugin[] = [];

  register(plugin: DefinitionPlugin): void {
    if (this.plugins.some((p) => p.formatName === plugin.formatName)) {
      throw new Error(
        `Definition plugin "${plugin.formatName}" is already registered.`,
      );
    }
    this.plugins.push(plugin);
  }

  /**
   * Find the first plugin that can handle the given file path.
   * Throws if no plugin matches.
   */
  resolve(filePath: string): DefinitionPlugin {
    const plugin = this.plugins.find((p) => p.canLoad(filePath));
    if (!plugin) {
      const supported = this.plugins
        .map((p) => p.formatName)
        .join(", ");
      throw new Error(
        `No definition plugin can load "${filePath}". ` +
          `Supported formats: ${supported || "none"}`,
      );
    }
    return plugin;
  }

  /** All registered plugins in insertion order. */
  all(): readonly DefinitionPlugin[] {
    return [...this.plugins];
  }
}

/** Central registry holding both domain and definition plugins. */
export class PluginRegistry {
  readonly domains = new DomainRegistry();
  readonly definitions = new DefinitionRegistry();
}
