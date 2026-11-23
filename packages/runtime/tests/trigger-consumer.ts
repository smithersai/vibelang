import { Effect, Layer, Schema } from "effect"
import { $workflow, Experimental } from "vibelang-runtime"
import { Durable, Trigger, WorkQueue } from "vibelang-runtime/experimental"

// Experimental.Trigger is typed by the workflow it starts: input is its payload.
const Report = Durable.workflow("consumer#Report", { payload: { channel: Schema.String } })
export const nightly: Effect.Effect<Trigger.Trigger<typeof Report>, Trigger.TriggerError> = Trigger.cron(Report, {
  id: "nightly",
  cron: "0 3 * * *",
  input: { channel: "#ops" }
})
// @ts-expect-error input is the workflow's payload.
export const wrongInput = Trigger.cron(Report, { id: "wrong", cron: "0 3 * * *", input: { channel: 7 } })
export const scheduler: Layer.Layer<never, Trigger.TriggerError, Trigger.Store | Trigger.RunnerService> = Trigger.layer([nightly])

// Experimental.WorkQueue needs a key, which names an offer.
export const Renders = WorkQueue.make("Renders", { payload: { page: Schema.String }, success: Schema.String, key: (job) => job.page })
// @ts-expect-error key is required.
export const noKey = WorkQueue.make("NoKey", { payload: { page: Schema.String } })

// Trigger.webhook maps the verified body to the workflow's payload.
export const deployHook = Trigger.webhook(Report, { path: "/hooks/report", verify: () => Effect.void, input: () => ({ channel: "#ops" }) })
// @ts-expect-error input must return the workflow's payload.
export const wrongHook = Trigger.webhook(Report, { path: "/hooks/report", verify: () => Effect.void, input: () => ({ channel: 7 }) })

// A declared `workflow` (VIP-55): a trigger's input is its parameter tuple.
const Digest_ = $workflow("consumer#Digest", {}, { payload: { channel: Schema.String, day: Schema.Number } }, (_channel: string, _day: number) => Effect.void)
export const daily: Effect.Effect<Trigger.Trigger<typeof Digest_>, Trigger.TriggerError> = Trigger.cron(Digest_, { id: "daily", cron: "0 3 * * *", input: ["#ops", 1] })
// @ts-expect-error input is the workflow's parameter tuple.
export const wrongTuple = Trigger.cron(Digest_, { id: "wrong", cron: "0 3 * * *", input: ["#ops"] })
// @ts-expect-error input is the workflow's parameter tuple, not a payload record.
export const recordInput = Trigger.cron(Digest_, { id: "wrong", cron: "0 3 * * *", input: { channel: "#ops", day: 1 } })
export const digestHook = Trigger.webhook(Digest_, { path: "/hooks/digest", verify: () => Effect.void, input: (body) => [String(body), 2] as const })
// @ts-expect-error input maps the body to the workflow's parameter tuple.
export const wrongDigestHook = Trigger.webhook(Digest_, { path: "/hooks/digest", verify: () => Effect.void, input: (body) => [String(body)] as const })
export const namedHook = Trigger.webhook(Digest_, { path: "/hooks/digest", verify: () => Effect.void, input: (body): Trigger.Input<typeof Digest_> => [String(body), 3] })
// Trigger.webhook with a signal delivers a value the signal's schema types.
const approved = Experimental.Durable.signal("approved", Schema.Struct({ by: Schema.String }))
export const approveHook = Trigger.webhook(Report, { path: "/hooks/approve", verify: () => Effect.void, signal: approved, deliver: () => ({ run: "r", value: { by: "ana" } }) })
// @ts-expect-error deliver's value is the signal's type.
export const wrongApproveHook = Trigger.webhook(Report, { path: "/hooks/approve", verify: () => Effect.void, signal: approved, deliver: () => ({ run: "r", value: { by: 7 } }) })
