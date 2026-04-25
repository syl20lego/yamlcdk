import { describe, expect, test } from "vitest";
import {
  isCfnGetAtt,
  isCfnRef,
  parseCfnYaml,
  resolveLogicalId,
} from "../cfn-yaml.js";

describe("CloudFormation YAML parsing", () => {
  test("parses !Ref intrinsic function", () => {
    const result = parseCfnYaml("value: !Ref MyResource") as Record<
      string,
      unknown
    >;
    expect(result.value).toEqual({ Ref: "MyResource" });
  });

  test("parses !GetAtt scalar form", () => {
    const result = parseCfnYaml("value: !GetAtt MyResource.Arn") as Record<
      string,
      unknown
    >;
    expect(result.value).toEqual({
      "Fn::GetAtt": ["MyResource", "Arn"],
    });
  });

  test("parses !GetAtt sequence form", () => {
    const result = parseCfnYaml(
      "value: !GetAtt [MyResource, Arn]",
    ) as Record<string, unknown>;
    expect(result.value).toEqual({
      "Fn::GetAtt": ["MyResource", "Arn"],
    });
  });

  test("parses !Sub scalar form", () => {
    const result = parseCfnYaml(
      'value: !Sub "arn:aws:s3:::${BucketName}"',
    ) as Record<string, unknown>;
    expect(result.value).toEqual({
      "Fn::Sub": "arn:aws:s3:::${BucketName}",
    });
  });

  test("parses !Join", () => {
    const yaml = 'value: !Join ["/", ["a", "b"]]';
    const result = parseCfnYaml(yaml) as Record<string, unknown>;
    expect(result.value).toEqual({ "Fn::Join": ["/", ["a", "b"]] });
  });

  test("parses full CloudFormation template", () => {
    const yaml = `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Handler: index.handler
      Runtime: nodejs20.x
  MyQueue:
    Type: AWS::SQS::Queue
  MyMapping:
    Type: AWS::Lambda::EventSourceMapping
    Properties:
      FunctionName: !Ref MyFunction
      EventSourceArn: !GetAtt MyQueue.Arn
`;
    const result = parseCfnYaml(yaml) as Record<string, unknown>;
    expect(result.AWSTemplateFormatVersion).toBe("2010-09-09");
    const resources = result.Resources as Record<
      string,
      Record<string, unknown>
    >;
    expect(resources.MyFunction.Type).toBe("AWS::Lambda::Function");
  });
});

describe("additional intrinsic parsing coverage", () => {
  test("parses scalar-only intrinsic tags into long-form syntax", () => {
    const parsed = parseCfnYaml(`
conditionName: !Condition IsProd
imported: !ImportValue shared-stack-output
encoded: !Base64 hello-world
zones: !GetAZs us-east-1
`) as Record<string, unknown>;

    expect(parsed.conditionName).toEqual({ Condition: "IsProd" });
    expect(parsed.imported).toEqual({ "Fn::ImportValue": "shared-stack-output" });
    expect(parsed.encoded).toEqual({ "Fn::Base64": "hello-world" });
    expect(parsed.zones).toEqual({ "Fn::GetAZs": "us-east-1" });
  });

  test("parses sequence-based intrinsic tags into long-form syntax", () => {
    const parsed = parseCfnYaml(`
subWithVars: !Sub ["arn:aws:s3:::\${Bucket}", { Bucket: MyBucket }]
selectValue: !Select [0, [a, b]]
ifValue: !If [IsProd, on, off]
equalsValue: !Equals [a, b]
andValue: !And [true, false]
orValue: !Or [true, false]
notValue: !Not [false]
mapValue: !FindInMap [RegionMap, us-east-1, AMI]
splitValue: !Split [",", "a,b"]
cidrValue: !Cidr [10.0.0.0/16, 4, 8]
`) as Record<string, unknown>;

    expect(parsed.subWithVars).toEqual({
      "Fn::Sub": ["arn:aws:s3:::${Bucket}", { Bucket: "MyBucket" }],
    });
    expect(parsed.selectValue).toEqual({ "Fn::Select": [0, ["a", "b"]] });
    expect(parsed.ifValue).toEqual({ "Fn::If": ["IsProd", "on", "off"] });
    expect(parsed.equalsValue).toEqual({ "Fn::Equals": ["a", "b"] });
    expect(parsed.andValue).toEqual({ "Fn::And": [true, false] });
    expect(parsed.orValue).toEqual({ "Fn::Or": [true, false] });
    expect(parsed.notValue).toEqual({ "Fn::Not": [false] });
    expect(parsed.mapValue).toEqual({
      "Fn::FindInMap": ["RegionMap", "us-east-1", "AMI"],
    });
    expect(parsed.splitValue).toEqual({ "Fn::Split": [",", "a,b"] });
    expect(parsed.cidrValue).toEqual({ "Fn::Cidr": ["10.0.0.0/16", 4, 8] });
  });

  test("parses nested intrinsic values inside arrays and objects", () => {
    const parsed = parseCfnYaml(`
Resources:
  BucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref UploadsBucket
      PolicyDocument:
        Statement:
          - Effect: Allow
            Action:
              - s3:GetObject
            Resource: !Sub arn:aws:s3:::\${Bucket}/*
            Principal:
              AWS: !ImportValue shared-principal
`) as Record<string, unknown>;

    const resources = parsed.Resources as Record<string, Record<string, unknown>>;
    const props = resources.BucketPolicy.Properties as Record<string, unknown>;

    expect(props.Bucket).toEqual({ Ref: "UploadsBucket" });

    const policy = props.PolicyDocument as Record<string, unknown>;
    const statements = policy.Statement as Array<Record<string, unknown>>;
    expect(statements[0].Resource).toEqual({ "Fn::Sub": "arn:aws:s3:::${Bucket}/*" });
    expect(statements[0].Principal).toEqual({
      AWS: { "Fn::ImportValue": "shared-principal" },
    });
  });
});

describe("intrinsic function type guards", () => {
  test("isCfnRef identifies Ref objects", () => {
    expect(isCfnRef({ Ref: "X" })).toBe(true);
    expect(isCfnRef({ "Fn::GetAtt": ["X", "Y"] })).toBe(false);
    expect(isCfnRef("string")).toBe(false);
    expect(isCfnRef(null)).toBe(false);
    expect(isCfnRef({})).toBe(false);
  });

  test("isCfnGetAtt identifies GetAtt objects", () => {
    expect(isCfnGetAtt({ "Fn::GetAtt": ["X", "Y"] })).toBe(true);
    expect(isCfnGetAtt({ Ref: "X" })).toBe(false);
    expect(isCfnGetAtt("Fn::GetAtt")).toBe(false);
    expect(isCfnGetAtt(null)).toBe(false);
  });

  test("resolveLogicalId extracts from Ref and GetAtt", () => {
    expect(resolveLogicalId({ Ref: "MyFunc" })).toBe("MyFunc");
    expect(resolveLogicalId({ "Fn::GetAtt": ["MyFunc", "Arn"] })).toBe(
      "MyFunc",
    );
    expect(resolveLogicalId("plain string")).toBeUndefined();
    expect(resolveLogicalId(42)).toBeUndefined();
    expect(resolveLogicalId({})).toBeUndefined();
  });
});

