import { Schema } from "effect";
/** @internal */
export const Message=Schema.Struct({id:Schema.String});
export type Message=typeof Message.Type;
/** Internal code.
 * @internal
 */
export const Code=Schema.String;
export type Code=typeof Code.Type;
export namespace N {
  /** @internal */
  export const Nested=Schema.Struct({n:Schema.Number});
  export type Nested=typeof Nested.Type;
}
/** Public schema. */
export const Public=Schema.Struct({value:Schema.String});
export type Public=typeof Public.Type;
