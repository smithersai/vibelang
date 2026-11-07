import { Effect } from "effect";
/**
 * Adds two numbers.
 * @throws {never}
 */
export declare function add(a: number, b: number): number;
/** @throws {never} */
export declare function bare(a: number): number;
/**
 * Loads by id.
 * @param id the key
 */
export declare function load(id: string): Effect.Effect<number, never, never>;
