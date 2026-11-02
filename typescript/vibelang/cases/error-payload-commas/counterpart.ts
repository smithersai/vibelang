import { Data, Schema } from "effect"
export class PlainFields extends Data.TaggedError("PlainFields")<{ readonly id: string; readonly count: number }> {  }
export class PlainOptional extends Data.TaggedError("PlainOptional")<{ readonly id?: string; readonly count: number }> {  }
export class PlainLiteral extends Data.TaggedError("PlainLiteral")<{ readonly "id": string; readonly 7: number }> {  }
export class PlainMembers extends Data.TaggedError("PlainMembers")<{ readonly id: string; readonly count: number }> { get label(): string { return this.id } }
export class PlainReadonly extends Data.TaggedError("PlainReadonly")<{ readonly id: string; readonly count: number }> {  }
export class PlainComments extends Data.TaggedError("PlainComments")<{ readonly id: string; /** @internal */ readonly count: number }> {  }
export class PlainMultiline extends Data.TaggedError("PlainMultiline")<{ readonly id: string | number; readonly count?: number }> {  }
export class PlainTrailing extends Data.TaggedError("PlainTrailing")<{ readonly id: string }> {  }
export class EncodedFields extends Schema.TaggedError<EncodedFields>()("EncodedFields", { id: Schema.String, count: Schema.Number }) {  }
export class EncodedOptional extends Schema.TaggedError<EncodedOptional>()("EncodedOptional", { id: Schema.optionalKey(Schema.String), count: Schema.Number }) {  }
export class EncodedLiteral extends Schema.TaggedError<EncodedLiteral>()("EncodedLiteral", { "id": Schema.String, 7: Schema.Number }) {  }
export class EncodedMembers extends Schema.TaggedError<EncodedMembers>()("EncodedMembers", { id: Schema.String, count: Schema.Number }) { get label(): string { return this.id } }
export class EncodedReadonly extends Schema.TaggedError<EncodedReadonly>()("EncodedReadonly", { id: Schema.String, count: Schema.Number }) {  }
export class EncodedComments extends Schema.TaggedError<EncodedComments>()("EncodedComments", { id: Schema.String, count: Schema.Number }) {  }
export class EncodedMultiline extends Schema.TaggedError<EncodedMultiline>()("EncodedMultiline", { id: Schema.Union([Schema.String, Schema.Number]), count: Schema.optionalKey(Schema.Number) }) {  }
export class EncodedTrailing extends Schema.TaggedError<EncodedTrailing>()("EncodedTrailing", { id: Schema.String }) {  }

export const matrix = [
  [PlainFields, new PlainFields({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, false],
  [PlainOptional, new PlainOptional({ count: 1 }), { count: 1 }, "count", 1, false],
  [PlainLiteral, new PlainLiteral({ id: "x", 7: 1 }), { id: "x", 7: 1 }, 7, 1, false],
  [PlainMembers, new PlainMembers({ id: "x", count: 1 }), { id: "x", count: 1 }, "label", "x", false],
  [PlainReadonly, new PlainReadonly({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, false],
  [PlainComments, new PlainComments({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, false],
  [PlainMultiline, new PlainMultiline({ id: "x" }), { id: "x" }, "id", "x", false],
  [PlainTrailing, new PlainTrailing({ id: "x" }), { id: "x" }, "id", "x", false],
  [EncodedFields, new EncodedFields({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, true],
  [EncodedOptional, new EncodedOptional({ count: 1 }), { count: 1 }, "count", 1, true],
  [EncodedLiteral, new EncodedLiteral({ id: "x", 7: 1 }), { id: "x", 7: 1 }, 7, 1, true],
  [EncodedMembers, new EncodedMembers({ id: "x", count: 1 }), { id: "x", count: 1 }, "label", "x", true],
  [EncodedReadonly, new EncodedReadonly({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, true],
  [EncodedComments, new EncodedComments({ id: "x", count: 1 }), { id: "x", count: 1 }, "count", 1, true],
  [EncodedMultiline, new EncodedMultiline({ id: "x" }), { id: "x" }, "id", "x", true],
  [EncodedTrailing, new EncodedTrailing({ id: "x" }), { id: "x" }, "id", "x", true]
] as const
