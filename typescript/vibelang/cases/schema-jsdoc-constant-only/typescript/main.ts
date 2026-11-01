import * as Schema from "effect/Schema"

/** Wire message. */
export const S0 = Schema.Struct({ id: Schema.String })
export type S0 = typeof S0.Type

/** First line.
 * Second line.
 */
export const S1 = Schema.Struct({ id: Schema.String })
export type S1 = typeof S1.Type

/** @internal */
export const S2 = Schema.Struct({ id: Schema.String })
export type S2 = typeof S2.Type

/** @deprecated Use another schema. */
export const S3 = Schema.Struct({ id: Schema.String })
export type S3 = typeof S3.Type

/** @public */
export const S4 = Schema.Struct({ id: Schema.String })
export type S4 = typeof S4.Type

