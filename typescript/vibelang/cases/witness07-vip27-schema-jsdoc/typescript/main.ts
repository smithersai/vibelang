import { Schema } from "effect";

/** A user. */
export const User = Schema.Struct({
  /** The id. */
  id: Schema.String,
});
export type User = typeof User.Type;

/**
 * A legacy name.
 * @deprecated Use User.
 */
export const Legacy = Schema.String;
export type Legacy = typeof Legacy.Type;

/**
 * The codes.
 * @internal
 */
export const Code = Schema.Literals(["a", "b"]);
export type Code = typeof Code.Type;

/** @public The visible name. */
export const Name = Schema.String;
export type Name = typeof Name.Type;

/** A constant after the schemas. */
export const after = 1;
