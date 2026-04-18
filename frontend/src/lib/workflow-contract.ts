import { z } from "zod";
import contract from "./workflow-contract.json";

const visibleStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const workflowContractSchema = z.object({
  version: z.string(),
  visible_statuses: z.array(visibleStatusSchema),
  internal_states: z.array(z.string()),
  failure_reasons: z.array(z.string()),
  workflow_kinds: z.array(z.string()),
  mapping_rules: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      when: z.record(z.unknown()),
    }),
  ),
  polling_progress_schema: z.object({
    required: z.array(z.string()),
    properties: z.record(z.string()),
  }),
});

export const workflowContract = workflowContractSchema.parse(contract);

export type VisibleStatusId = (typeof workflowContract.visible_statuses)[number]["id"];

export const visibleStatuses = workflowContract.visible_statuses;
