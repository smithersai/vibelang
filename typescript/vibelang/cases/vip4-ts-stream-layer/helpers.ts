import { Stream, Layer } from "effect"
export const expectedStream = Stream.succeed(1)
export const expectedLayer = Layer.empty
export function stream() { return expectedStream }
export function layer() { return expectedLayer }
