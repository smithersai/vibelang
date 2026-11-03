import { Effect } from "effect"
export function fib(n: number): number { return n < 2 ? n : fib(n-1) + fib(n-2) }
export function walk(n: number): number { if (n === 0) throw new Error("walk"); return walk(n-1) }
export function even(n: number): number { if (n === 0) throw new Error("mutual"); return odd(n-1) }
export function odd(n: number): number { return even(n-1) }
export function expand<T>(value: T, stop: boolean): never { if (stop) throw value; return expand({value},stop) }
/** @throws {Error} */
export function bounded(stop: boolean): number { if (stop) throw new Error("bound"); return 1 }
/** @rethrows f */
export function invoke(f: () => number): number { return f() }
/** @rethrows f */
export function defaulted(f: () => number = () => { throw new Error("default") }): number { return f() }
/** @rethrows f */
export async function asyncDefaulted(f: () => number = () => { throw new Error("default") }): Promise<number> { return f() }
