/**
 * CloudFormation YAML definition plugin.
 *
 * Translates native CloudFormation YAML templates into the canonical
 * {@link ServiceModel} consumed by the compiler pipeline.
 *
 * Detection: matches YAML files that contain `AWSTemplateFormatVersion`
 * or a `Resources` section with `Type: AWS::*` entries.
 *
 * Service-level config (service name, stage, region, tags, deployment)
 * is read from the `Metadata.yamlcdk` section of the template.
 */

import fs from "node:fs";
import type { DefinitionPlugin } from "../../compiler/plugins/index.js";
import type { ServiceModel } from "../../compiler/model.js";
import { parseCfnYaml } from "./cfn-yaml.js";
import { adaptCfnTemplate } from "./adapt.js";

const STARTER_TEMPLATE = `AWSTemplateFormatVersion: "2010-09-09"
Description: My service deployed with yamlcdk

Metadata:
  yamlcdk:
    service: my-service
    stage: dev
    region: us-east-1

Resources:
  # ─── Lambda Functions ──────────────────────────────────────

  HelloFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: src/handlers/hello.handler
      Runtime: nodejs20.x
      Timeout: 10
      MemorySize: 256
      Environment:
        Variables:
          STAGE: dev

  HelloFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !GetAtt HelloFunction.Arn
      AuthType: NONE
      Cors:
        AllowMethods:
          - GET
        AllowOrigins:
          - https://example.com

  # ─── Storage ───────────────────────────────────────────────

  UploadsBucket:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled

  UsersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
      BillingMode: PAY_PER_REQUEST

  # ─── Messaging ─────────────────────────────────────────────

  JobsQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 30

  EventsTopic:
    Type: AWS::SNS::Topic

  EventsToJobs:
    Type: AWS::SNS::Subscription
    Properties:
      Protocol: sqs
      TopicArn: !Ref EventsTopic
      Endpoint: !GetAtt JobsQueue.Arn

  # ─── Event Wiring ──────────────────────────────────────────

  HelloSqsTrigger:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref HelloFunction
      EventSourceArn: !GetAtt JobsQueue.Arn
      BatchSize: 10

  # ─── API Gateway (HTTP API) ────────────────────────────────

  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: my-service-api
      ProtocolType: HTTP

  HelloIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt HelloFunction.Arn
      PayloadFormatVersion: "2.0"

  HelloRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: "GET /hello"
      Target: !Join ["/", ["integrations", !Ref HelloIntegration]]
`;

export const cloudformationDefinitionPlugin: DefinitionPlugin = {
  formatName: "cloudformation",

  canLoad(filePath: string): boolean {
    if (!/\.(yml|yaml)$/i.test(filePath)) return false;
    try {
      const head = fs.readFileSync(filePath, "utf8").slice(0, 4096);
      const looksLikeServerless =
        /^\s*service\s*:/m.test(head) &&
        (/^\s*provider\s*:\s*aws\s*$/m.test(head) ||
          (/^\s*provider\s*:/m.test(head) && /^\s+name\s*:\s*aws\s*$/m.test(head)));
      if (looksLikeServerless && !/^\s*AWSTemplateFormatVersion\s*:/m.test(head)) {
        return false;
      }
      // Require AWSTemplateFormatVersion at top level, or a Resources block
      // with indented Type: AWS::* entries (rules out yamlcdk files that
      // might mention AWS:: in string values or comments)
      return (
        /^\s*AWSTemplateFormatVersion\s*:/m.test(head) ||
        (/^\s*Resources\s*:/m.test(head) &&
          /^\s+Type\s*:\s*['"]?AWS::/m.test(head))
      );
    } catch {
      return false;
    }
  },

  load(filePath: string): ServiceModel {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = parseCfnYaml(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(
        `Failed to parse CloudFormation template: ${filePath}`,
      );
    }
    return adaptCfnTemplate(parsed, filePath);
  },

  generateStarter(): string {
    return STARTER_TEMPLATE;
  },
};
