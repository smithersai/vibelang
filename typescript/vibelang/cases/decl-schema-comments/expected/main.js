/**
 * The file's header.
 */
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
/** The codes. */
export const Code = Schema.Literals(["a",
    "b"]);
/** A user. */
export const User = Schema.Struct({
    /** The id. */
    id: Schema.String,
    /** The nickname. */
    nick: Schema.optional(Schema.String),
    /** The address. */
    home: Schema.Struct({
        /** The city. */
        city: Schema.String,
    }),
});
/** A name. */
export const Name = Schema.String;
/** Nothing. */
export const Nothing = Schema.Null;
/** After the schemas. */
export const after = 1;
// expect-result: {"code":"b","user":{"id":"1","home":{"city":"Paris"}}}
export function main() {
    return Effect.gen(function* main() {
        const code = yield* Schema.decodeUnknownEffect(Code)("b");
        const user = yield* Schema.decodeUnknownEffect(User)({ id: "1", home: { city: "Paris" } });
        return { code, user };
    });
}
