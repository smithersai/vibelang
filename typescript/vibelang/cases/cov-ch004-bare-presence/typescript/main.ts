import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const tracking = "outer"
const subject = { tracking: "payload", _tag: "Sent" }
return ["tracking" in subject ? tracking : "none", subject._tag === "Sent" && "tracking" in subject ? subject.tracking : "none"]
}) }
