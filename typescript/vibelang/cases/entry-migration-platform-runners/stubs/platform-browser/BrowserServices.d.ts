// A stand-in whose layer declares the services the case's main needs.
import type { FileSystem } from "effect/FileSystem"
import * as Layer from "effect/Layer"
import type { Path } from "effect/Path"

export type BrowserServices = FileSystem | Path
export declare const layer: Layer.Layer<BrowserServices>
