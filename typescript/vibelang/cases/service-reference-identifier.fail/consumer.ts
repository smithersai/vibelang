import { ImportedFlags } from "./flags.vibe"
export let invalidConsumer: ImportedFlags
export let validConsumer: ImportedFlags.Shape
export type Value = typeof ImportedFlags
export type InvalidImport = import("./flags.vibe").ImportedFlags
export type ImportedKey = typeof import("./flags.vibe").ImportedFlags
