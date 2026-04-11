import { describe, expect, test, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  parseDotEnvFile,
  resolveDefinitionVariables,
} from "../resolve.js";

describe("parseDotEnvFile", () => {
  test("parses basic KEY=VALUE pairs", () => {
    const result = parseDotEnvFile("FOO=bar\nBAZ=qux");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("skips comments and empty lines", () => {
    const result = parseDotEnvFile(`
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("strips double quotes from values", () => {
    const result = parseDotEnvFile('FOO="hello world"');
    expect(result).toEqual({ FOO: "hello world" });
  });

  test("strips single quotes from values", () => {
    const result = parseDotEnvFile("FOO='hello world'");
    expect(result).toEqual({ FOO: "hello world" });
  });

  test("handles empty values", () => {
    const result = parseDotEnvFile("FOO=");
    expect(result).toEqual({ FOO: "" });
  });

  test("trims whitespace around key and value", () => {
    const result = parseDotEnvFile("  FOO  =  bar  ");
    expect(result).toEqual({ FOO: "bar" });
  });

  test("handles values containing equals sign", () => {
    const result = parseDotEnvFile("FOO=bar=baz");
    expect(result).toEqual({ FOO: "bar=baz" });
  });

  test("skips lines without equals sign", () => {
    const result = parseDotEnvFile("INVALID_LINE\nFOO=bar");
    expect(result).toEqual({ FOO: "bar" });
  });

  test("handles Windows-style line endings", () => {
    const result = parseDotEnvFile("FOO=bar\r\nBAZ=qux\r\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});

describe(".env file loading in resolveDefinitionVariables", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const envKeysToClean: string[] = [];

  function saveEnvKey(key: string) {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key];
      envKeysToClean.push(key);
    }
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yamlcdk-dotenv-"));
  });

  afterEach(() => {
    for (const key of envKeysToClean) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    envKeysToClean.length = 0;
    Object.keys(savedEnv).forEach((k) => delete savedEnv[k]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  test("loads .env file and resolves ${env:...} from it", () => {
    saveEnvKey("DOTENV_TEST_DB_HOST");
    delete process.env.DOTENV_TEST_DB_HOST;

    writeFile(".env", "DOTENV_TEST_DB_HOST=localhost");
    const yamlPath = writeFile(
      "service.yml",
      `
service: demo
provider:
  region: us-east-1
custom:
  dbHost: \${env:DOTENV_TEST_DB_HOST}
`,
    );

    const resolved = resolveDefinitionVariables(yaml.load(fs.readFileSync(yamlPath, "utf8")), {
      entryFilePath: yamlPath,
      parseContent: (c) => yaml.load(c),
    }) as Record<string, unknown>;

    expect((resolved.custom as Record<string, unknown>).dbHost).toBe("localhost");
  });

  test("OS environment takes precedence over .env file", () => {
    saveEnvKey("DOTENV_TEST_PRIORITY");
    process.env.DOTENV_TEST_PRIORITY = "from-os";

    writeFile(".env", "DOTENV_TEST_PRIORITY=from-dotenv");
    const yamlPath = writeFile(
      "service.yml",
      `
service: demo
provider:
  region: us-east-1
custom:
  val: \${env:DOTENV_TEST_PRIORITY}
`,
    );

    const resolved = resolveDefinitionVariables(yaml.load(fs.readFileSync(yamlPath, "utf8")), {
      entryFilePath: yamlPath,
      parseContent: (c) => yaml.load(c),
    }) as Record<string, unknown>;

    expect((resolved.custom as Record<string, unknown>).val).toBe("from-os");
  });

  test("loads stage-specific .env.{stage} with higher priority than .env", () => {
    saveEnvKey("DOTENV_TEST_STAGE_VAR");
    delete process.env.DOTENV_TEST_STAGE_VAR;

    writeFile(".env", "DOTENV_TEST_STAGE_VAR=base-value");
    writeFile(".env.prod", "DOTENV_TEST_STAGE_VAR=prod-value");
    const yamlPath = writeFile(
      "service.yml",
      `
service: demo
provider:
  region: us-east-1
custom:
  val: \${env:DOTENV_TEST_STAGE_VAR}
`,
    );

    const resolved = resolveDefinitionVariables(yaml.load(fs.readFileSync(yamlPath, "utf8")), {
      entryFilePath: yamlPath,
      parseContent: (c) => yaml.load(c),
      stage: "prod",
    }) as Record<string, unknown>;

    expect((resolved.custom as Record<string, unknown>).val).toBe("prod-value");
  });

  test("gracefully handles missing .env file", () => {
    saveEnvKey("DOTENV_TEST_FALLBACK");
    delete process.env.DOTENV_TEST_FALLBACK;

    const yamlPath = writeFile(
      "service.yml",
      `
service: demo
provider:
  region: us-east-1
custom:
  val: \${env:DOTENV_TEST_FALLBACK, 'default-val'}
`,
    );

    const resolved = resolveDefinitionVariables(yaml.load(fs.readFileSync(yamlPath, "utf8")), {
      entryFilePath: yamlPath,
      parseContent: (c) => yaml.load(c),
    }) as Record<string, unknown>;

    expect((resolved.custom as Record<string, unknown>).val).toBe("default-val");
  });

  test("without stage option, only .env is loaded (not .env.{stage})", () => {
    saveEnvKey("DOTENV_TEST_NO_STAGE");
    delete process.env.DOTENV_TEST_NO_STAGE;

    writeFile(".env", "DOTENV_TEST_NO_STAGE=base");
    writeFile(".env.dev", "DOTENV_TEST_NO_STAGE=dev-specific");
    const yamlPath = writeFile(
      "service.yml",
      `
service: demo
provider:
  region: us-east-1
custom:
  val: \${env:DOTENV_TEST_NO_STAGE}
`,
    );

    const resolved = resolveDefinitionVariables(yaml.load(fs.readFileSync(yamlPath, "utf8")), {
      entryFilePath: yamlPath,
      parseContent: (c) => yaml.load(c),
    }) as Record<string, unknown>;

    expect((resolved.custom as Record<string, unknown>).val).toBe("base");
  });
});
