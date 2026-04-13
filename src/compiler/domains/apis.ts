import cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { withStageName } from "../stack/helpers.js";
import { APIS_CONFIG } from "../plugins/index.js";
import type { DomainPlugin } from "../plugins/index.js";

export const apisDomain: DomainPlugin = {
  name: "apis",

  bind(ctx, events) {
    const apisConfig = ctx.model.domainConfigs.get(APIS_CONFIG);

    const httpEvents = events.filter((e) => e.type === "http");
    const restEvents = events.filter((e) => e.type === "rest");

    // HTTP API (v2)
    const httpApi =
      httpEvents.length > 0
        ? new apigwv2.HttpApi(ctx.stack, "HttpApi", {
            apiName: withStageName(
              ctx.model.service,
              ctx.model.provider.stage,
            ),
          })
        : undefined;

    // REST API (v1)
    const providedCloudWatchRoleArn =
      apisConfig?.restApi?.cloudWatchRoleArn;
    const restApi =
      restEvents.length > 0
        ? new apigw.RestApi(ctx.stack, "RestApi", {
            restApiName: withStageName(
              `${ctx.model.service}-rest`,
              ctx.model.provider.stage,
            ),
            deployOptions: { stageName: ctx.model.provider.stage },
            // Avoid creating/tagging an IAM role in deploy accounts that may not allow iam:TagRole.
            cloudWatchRole: false,
          })
        : undefined;

    if (restApi && providedCloudWatchRoleArn) {
      new apigw.CfnAccount(ctx.stack, "RestApiCloudWatchAccount", {
        cloudWatchRoleArn: providedCloudWatchRoleArn,
      });
    }

    // Bind HTTP routes
    for (const event of httpEvents) {
      if (event.type !== "http" || !httpApi) continue;
      httpApi.addRoutes({
        path: event.path,
        methods: [event.method.toUpperCase() as apigwv2.HttpMethod],
        integration: new apigwv2Integrations.HttpLambdaIntegration(
          `${event.functionName}-${event.method}-${event.path}`,
          event.fnResource,
        ),
      });
    }

    // Bind REST routes
    let hasAnyApiKeyRequired = false;
    for (const event of restEvents) {
      if (event.type !== "rest" || !restApi) continue;
      const resource = restApi.root.resourceForPath(event.path);
      resource.addMethod(
        event.method.toUpperCase(),
        new apigw.LambdaIntegration(event.fnResource, { proxy: true }),
        { apiKeyRequired: event.apiKeyRequired },
      );
      if (event.apiKeyRequired) hasAnyApiKeyRequired = true;
    }

    // API key / usage plan
    if (restApi && hasAnyApiKeyRequired) {
      const apiKey = restApi.addApiKey("RestApiKey");
      const usagePlan = restApi.addUsagePlan("RestApiUsagePlan", {
        name: withStageName(
          `${ctx.model.service}-rest-plan`,
          ctx.model.provider.stage,
        ),
      });
      usagePlan.addApiKey(apiKey);
      usagePlan.addApiStage({ stage: restApi.deploymentStage });
    }

    // Outputs
    if (httpApi) {
      const httpApiUrl = httpApi.url ?? "n/a";
      ctx.availableOutputs.set("HttpApiUrl", httpApiUrl);
      ctx.availableOutputs.set("HttpApiId", httpApi.apiId);
      new cdk.CfnOutput(ctx.stack, "HttpApiUrl", {
        value: httpApiUrl,
      });
    }
    if (restApi) {
      ctx.availableOutputs.set("ServiceEndpoint", restApi.url);
      ctx.availableOutputs.set("RestApiUrl", restApi.url);
      ctx.availableOutputs.set("RestApiId", restApi.restApiId);
      new cdk.CfnOutput(ctx.stack, "RestApiUrl", {
        value: restApi.url,
      });
    }
  },
};
