/** Advisory host-authored data, never an executable workflow or a record of completed work. */
export interface ContextPlanStep {
  readonly id: string;
  readonly goal: string;
  readonly evidence: string;
  /** Earlier step IDs only; list order must already be topological. */
  readonly dependsOn: readonly string[];
}
export interface ContextPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly revision: number;
  readonly objective: string;
  readonly steps: readonly ContextPlanStep[];
}
export const PLAN_LIMITS = Object.freeze({ steps: 8, textBytes: 512, planBytes: 6144, messageBytes: 8192 });
