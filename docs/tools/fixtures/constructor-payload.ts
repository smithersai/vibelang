// Native TypeScript witness retained from chapter 003 before 66e1ff463707.
// Authority: current VIP-4/VIP-5 native exception and execution boundaries.
import { Data, Effect } from "effect"

class PayloadCopyError extends Data.TaggedError("PayloadCopyError")<{ readonly value: number }> {}
type CopiedPayload = Data.TaggedEnum<{ Item: { readonly value: number } }>
const CopiedPayload = Data.taggedEnum<CopiedPayload>()
function copyPayload(kind: "error" | "data") {
  return Effect.gen(function* () {
    const payload = { get value(): number { throw "payload" } }
    if (kind === "error") return yield* Effect.fail(new PayloadCopyError(payload))
    return CopiedPayload.Item(payload)
  })
}
// Both inputs die with "payload"; the constructors keep their static never contract.
