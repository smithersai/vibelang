import { Schema } from "effect"

/** A 2D point in canvas-local coordinates. */
export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
/** A 2D point in canvas-local coordinates. */
export type Point = typeof Point.Type

/** The preserved model, as stored. */
export const Preserved = Schema.Struct({ version: Schema.Number })
/** The decoded preserved model. */
export type Preserved = typeof Preserved.Type

/** Documented on the constant alone. */
export const Bare = Schema.Struct({ id: Schema.String })
export type Bare = typeof Bare.Type
