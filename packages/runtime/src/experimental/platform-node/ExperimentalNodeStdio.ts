/**
 * Effect's Node standard I/O plus listener-only stdin closure observation.
 * @experimental
 * @since 0.0.11
 */
import * as EffectNodeStdio from "@effect/platform-node/NodeStdio"
import type * as EffectStdio from "effect/Stdio"
import * as Layer from "effect/Layer"
import type * as Stdio from "../Stdio.js"
import * as internal from "../internal/stdio.js"

/** Provides both Stdio keys, preserving Effect's stream and sinks. @since 0.0.11 */
export const layer: Layer.Layer<Stdio.Stdio | EffectStdio.Stdio> = Layer.provideMerge(
  internal.layer, EffectNodeStdio.layer
)
