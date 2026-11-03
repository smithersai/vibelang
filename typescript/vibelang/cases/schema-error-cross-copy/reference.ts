import { Schema } from "effect"

class Gone extends Schema.TaggedError<Gone>()("Gone", { id: Schema.String }) {}
class ForeignGone extends Schema.TaggedError<ForeignGone>()("Gone", { id: Schema.String }) {}
class Other extends Schema.TaggedError<Other>()("Other", { id: Schema.String }) {}

// VIP-7/VIP-29: the declaration matcher tests the tag and extracts the subject.
const gone = (subject: unknown): false | [unknown] =>
  subject !== null && (typeof subject === "object" || typeof subject === "function") &&
    (subject as { _tag?: unknown })._tag === "Gone" ? [subject] : false

export function reference(): unknown[] {
  const subjects: unknown[] = [
    new Gone({ id: "local" }),
    new ForeignGone({ id: "foreign" }),
    { _tag: "Gone" },
    Object.assign(Object.create(null), { _tag: "Gone" }),
    Object.assign(() => 1, { _tag: "Gone" }),
    new Other({ id: "other" }),
    { _tag: "Other" }, null, undefined, "Gone", 1
  ]
  return subjects.map((subject) => {
    const extracted = gone(subject)
    const test = gone(subject) !== false
    const value = extracted !== false && extracted.length === 1 && extracted[0] === subject
    return [test, value, test, value]
  })
}
