import * as Context from "effect/Context"

/** The parent activity's replay key and attempt, or the empty string in the workflow body. */
export class StepScope extends Context.Reference<string>("vibelang/experimental/record/StepScope", {
  defaultValue: () => ""
}) {}
