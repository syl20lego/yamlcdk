import { z } from "zod";
import { createDomainConfigKey } from "../../compiler/plugins/domain-configs.js";

export const eventBridgeEventBusConfigSchema = z.object({
  eventBusName: z.string().min(1).optional(),
  eventSourceName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export type EventBridgeEventBusConfig = z.infer<
  typeof eventBridgeEventBusConfigSchema
>;

export const eventbridgeYamlcdkMessagingSchema = z.record(
  z.string(),
  eventBridgeEventBusConfigSchema,
);

export const eventBridgeDomainConfigSchema = z.object({
  eventBuses: eventbridgeYamlcdkMessagingSchema.default({}),
});

export type EventBridgeDomainConfig = z.infer<typeof eventBridgeDomainConfigSchema>;

export const EVENTBRIDGE_CONFIG = createDomainConfigKey(
  "eventbridge",
  eventBridgeDomainConfigSchema,
);
