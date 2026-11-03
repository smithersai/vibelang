import { Cause, Data, Effect, Exit, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
class CopyError extends Data.TaggedError("CopyError")<{ readonly value: number }> {}
type Copies = Data.TaggedEnum<{ Copy: { value: number } }>
const Copies = Data.taggedEnum<Copies>()
const token = { failure: "copy" }
let reads = 0
const payload = { get value(): number { reads++; throw token } }
function build() { return Effect.gen(function* () { return new CopyError(payload) }) }
function variant() { return Effect.gen(function* () { return Copies.Copy(payload) }) }
export const contract: Equal<ReturnType<typeof build>, Effect.Effect<CopyError>> = true
function ordinary() { try { new CopyError(payload); return false } catch (e) { return e === token } }
export function main() {
  return Effect.gen(function* () {
    const delayed = build()
    const cold = reads === 0
    const first = yield* Effect.exit(delayed)
    const plain = ordinary()
    const second = yield* Effect.exit(variant())
    return [cold, plain, reads, Exit.isFailure(first) && Cause.squash(first.cause) === token, Exit.isFailure(second) && Cause.squash(second.cause) === token]
  })
}
