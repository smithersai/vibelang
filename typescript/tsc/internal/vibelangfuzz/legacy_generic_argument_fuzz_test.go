package vibelangfuzz

import ()

var legacyGenericSignatures = map[string]string{
	"shared-optional":   "declare function check<T>(actual: T, other?: T): T",
	"shared-record":     "declare function check<T>(actual: T, other: { value: T }): T",
	"shared-tuple":      "declare function check<T>(actual: T, other: readonly [T]): T",
	"shared-callback":   "declare function check<T>(actual: T, other: () => T): T",
	"different-sibling": "declare function check<T, U>(actual: T, other: U): T",
	"shared-value":      "declare function check<T>(actual: T, other: T): T",
	"shared":            "declare function check<T>(actual: T, other: T): T",
	"one":               "declare function check<T>(actual: T): T",
	"optional":          "declare function check<T>(actual: T, message?: string): T",
	"two-type":          "declare function check<T, U = string>(actual: T, other?: U): T",
	"rest":              "declare function check<T>(actual: T, ...rest: Array<string>): T",
	"unknown":           "declare function check<T extends unknown>(actual: T, message?: string): T",
}

var legacyGenericSiblings = map[string]string{
	"shared":            "Effect.succeed(2)",
	"shared-value":      "2",
	"shared-optional":   "Effect.succeed(2)",
	"shared-record":     "{ value: Effect.succeed(2) }",
	"shared-tuple":      "[Effect.succeed(2)] as const",
	"shared-callback":   "() => Effect.succeed(2)",
	"different-sibling": "Effect.succeed(2)",
}

var legacyGenericPositions = map[string]string{
	"return":      "export effect function f(): number!! {\n  return check(load(1)) + 1\n}\n",
	"initializer": "export effect function f(): number!! {\n  const n: number = check(load(1))\n  return n\n}\n",
	"argument":    "export effect function f(): number!! {\n  return plain(check(load(1)))\n}\n",
	"member":      "export effect function f(): number!! {\n  return check(load(1)).toFixed(1).length\n}\n",
	"arrow":       "export const f = effect (): number!! => check(load(1)) + 1\n",
}

const legacyGenericHelpers = `import { Effect } from "effect"

function load(n: number): Effect.Effect<number> {
  return Effect.succeed(n)
}

function plain(n: number): number {
  return n
}

`
