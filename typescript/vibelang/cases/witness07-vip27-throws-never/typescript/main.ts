import { Effect } from "effect"
/** Adds two numbers. */
export function add(a: number, b: number) { return a + b }
export function bare(a: number) { return a }
/**
 * Loads by id.
 * @param id the key
 */
export function load(id: string) { return Effect.gen(function* () { return id.length }) }
