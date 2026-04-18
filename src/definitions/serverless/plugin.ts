import fs from "node:fs";
import path from "node:path";
import type { DefinitionPlugin } from "../../compiler/plugins/index.js";
import type { DefinitionPluginLoadOptions } from "../../compiler/plugins/index.js";
import type { ServiceModel } from "../../compiler/model.js";
import { parseCfnYaml } from "../cloudformation/cfn-yaml.js";
import { adaptServerlessConfig } from "./service-adapter.js";

const STARTER_TEMPLATE = `service: my-service
provider:
  name: aws
  stage: dev
  region: us-east-1
  runtime: nodejs20.x

functions:
  hello:
    handler: src/handlers/hello.handler
    timeout: 10
    memorySize: 256
    environment:
      STAGE: \${sls:stage}
    url:
      cors: true
    events:
      - http: GET /hello
      - httpApi:
          method: POST
          path: /hello
      - sqs:
          arn: !GetAtt JobsQueue.Arn
          batchSize: 10

resources:
  Resources:
    JobsQueue:
      Type: AWS::SQS::Queue
      Properties:
        VisibilityTimeout: 30
`;

export const serverlessDefinitionPlugin: DefinitionPlugin = {
  formatName: "serverless",

  canLoad(filePath: string): boolean {
    if (!/\.(yml|yaml)$/i.test(filePath)) return false;

    const basename = path.basename(filePath).toLowerCase();
    if (basename === "serverless.yml" || basename === "serverless.yaml") {
      return true;
    }

    try {
      const head = fs.readFileSync(filePath, "utf8").slice(0, 4096);
      return (
        /^\s*service\s*:/m.test(head) &&
        (/^\s*provider\s*:\s*aws\s*$/m.test(head) ||
          (/^\s*provider\s*:/m.test(head) && /^\s+name\s*:\s*aws\s*$/m.test(head)))
      );
    } catch {
      return false;
    }
  },

  load(filePath: string, options: DefinitionPluginLoadOptions = {}): ServiceModel {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = parseCfnYaml(content);
    return adaptServerlessConfig(parsed, filePath, options);
  },

  generateStarter(): string {
    return STARTER_TEMPLATE;
  },
};
