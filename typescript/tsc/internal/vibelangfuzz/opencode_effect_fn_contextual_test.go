package vibelangfuzz

import (
	"strings"
)

const effectFnContextualTarget = "FuzzEffectFnContextualChannels"

// Minimized from opencode's core plugin/verbosity: an Effect.fn plugin body
// whose holder gives it a contextual Effect type wider than its body needs.
// Holders: satisfies, a plain generic parameter, an annotated property object,
// an annotated function binding, and satisfies with a wider success type
// (opencode's core worktree/git strategy). Bodies: the services and error the body
// yields. The oracle compares declarations with the .ts twin through the
// migration API-identity checker.
var effectFnContextualHolders = []string{"satisfies", "generic", "property", "annotated", "success"}
var effectFnContextualBodies = []string{"a", "b", "ab", "fail", "a-fail", "none"}

func effectFnContextualSource(holder, body string) string {
	var lines []string
	if strings.Contains(body, "a") && body != "fail" {
		lines = append(lines, "    const a = yield* A", "    if (a.n > ctx.length) return")
	}
	if strings.Contains(body, "b") {
		lines = append(lines, "    const b = yield* B", "    if (b.m > ctx.length) return")
	}
	if strings.HasSuffix(body, "fail") {
		lines = append(lines, "    if (ctx === \"\") return yield* new Missing()")
	}
	if body == "none" {
		lines = append(lines, "    yield* Effect.void")
	}
	fn := "Effect.fn(\"P\")(function* (ctx: string) {\n" + strings.Join(lines, "\n") + "\n  })"
	prelude := `import { Context, Data, Effect, Scope } from "effect"
export class A extends Context.Service<A, { readonly n: number }>()("A") {}
export class B extends Context.Service<B, { readonly m: number }>()("B") {}
export class Missing extends Data.TaggedError("Missing")<{}> {}
export class Denied extends Data.TaggedError("Denied")<{}> {}
export interface Plugin<E, R> { readonly id: string; readonly effect: (ctx: string) => Effect.Effect<void, E, R> }
export function define<E, R>(plugin: Plugin<E, R>): Plugin<E, R> { return plugin }
export type Wide = Plugin<Missing | Denied, A | B | Scope.Scope>
export interface Info { readonly directory: string; readonly branch?: string }
export interface Strategy { readonly create: (ctx: string) => Effect.Effect<Info, Missing | Denied, A | B> }
`
	switch holder {
	case "success":
		fn = strings.ReplaceAll(fn, ") return\n", ") return { directory: ctx }\n")
		fn = strings.Replace(fn, "\n  })", "\n    return { directory: ctx }\n  })", 1)
		return prelude + "export const P = {\n  create: " + fn + ",\n} satisfies Strategy\n"
	case "satisfies":
		return prelude + "export const P = define({\n  id: \"p\",\n  effect: " + fn + ",\n} satisfies Wide)\n"
	case "generic":
		return prelude + "export const P = define({\n  id: \"p\",\n  effect: " + fn + ",\n})\n"
	case "property":
		return prelude + "export const P: Wide = {\n  id: \"p\",\n  effect: " + fn + ",\n}\n"
	default:
		return prelude + "export const P: (ctx: string) => Effect.Effect<void, Missing | Denied, A | B> = " + fn + "\n"
	}
}
