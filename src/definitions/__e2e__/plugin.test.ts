import { describe, expect, test } from "vitest";
import { definitionRegistry } from "../registry.js";
import {writeTmpYaml} from "../test-utils/e2e.js";


describe("definition registry", () => {
    test("resolves CloudFormation templates to cfn plugin", () => {
        const cfnPath = writeTmpYaml(
            'AWSTemplateFormatVersion: "2010-09-09"\nResources: {}',
        );
        const plugin = definitionRegistry.resolve(cfnPath);
        expect(plugin.formatName).toBe("cloudformation");
    });

    test("resolves yamlcdk files to yamlcdk plugin", () => {
        const yamlcdkPath = writeTmpYaml(
            "service: my-service\nfunctions: {}",
        );
        const plugin = definitionRegistry.resolve(yamlcdkPath);
        expect(plugin.formatName).toBe("yamlcdk");
    });

    test("resolves serverless.yml files to serverless plugin", () => {
        const serverlessPath = writeTmpYaml(
            "service: my-service\nprovider:\n  name: aws\nfunctions: {}\n",
            "serverless.yml",
        );
        const plugin = definitionRegistry.resolve(serverlessPath);
        expect(plugin.formatName).toBe("serverless");
    });

    test("contains both plugins", () => {
        const formats = definitionRegistry.all().map((p) => p.formatName);
        expect(formats).toContain("cloudformation");
        expect(formats).toContain("serverless");
        expect(formats).toContain("yamlcdk");
    });
});
