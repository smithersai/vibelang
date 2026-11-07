package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const effectFnContextualTarget = "FuzzEffectFnContextualChannels"
const effectFnContextualQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestEffectFnContextualChannelsQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), effectFnContextualQuote) {
		t.Fatalf("chapter 7 no longer says %q", effectFnContextualQuote)
	}
}

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

func FuzzEffectFnContextualChannels(f *testing.F) {
	startShortBudget(f)
	// Keyed corpus files cover each shape; keys are holder:body.
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, key string, n byte) {
		holder, body, ok := strings.Cut(key, ":")
		if !ok || !slices.Contains(effectFnContextualHolders, holder) || !slices.Contains(effectFnContextualBodies, body) {
			holder = effectFnContextualHolders[int(n)%len(effectFnContextualHolders)]
			body = effectFnContextualBodies[int(n/4)%len(effectFnContextualBodies)]
			key = holder + ":" + body
		}
		TestEffectFnContextualChannelsQuoted(t)
		source := effectFnContextualSource(holder, body)
		twin := toolsCompile(t, w, effectFnContextualTarget, map[string]string{"main.ts": source})
		defer twin.Remove()
		if !toolsErrorFree(twin) {
			t.Fatalf("invalid .ts twin: %v\n%s", SortedKeys(Keys(twin.Dir, twin.Diagnostics)), source)
		}
		before := toolsCompile(t, w, effectFnContextualTarget, map[string]string{"main.vibe": source})
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if strings.Contains(fixed, "function*") {
			Gap(t, effectFnContextualTarget, key, "chapter 7: Effect.fn rewrite refused: %+v\n%s", result.Refused, source)
		}
		after := toolsCompile(t, w, effectFnContextualTarget, map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, effectFnContextualTarget, key, "chapter 7: fixed program has errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed)
		}
		baseline, current := t.TempDir(), t.TempDir()
		for _, side := range []struct {
			dir    string
			result *Result
		}{{baseline, twin}, {current, after}} {
			count := 0
			for name, text := range side.result.Outputs {
				if strings.HasPrefix(name, "out/") && isDeclaration(name) {
					if err := writeInside(side.dir, strings.TrimPrefix(name, "out/"), text); err != nil {
						t.Fatal(err)
					}
					count++
				}
			}
			if count == 0 {
				t.Fatal("no declaration output")
			}
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		diff, err := compareIdentityDeclarations(ctx, api, baseline, current)
		if err != nil {
			t.Fatal(err)
		}
		if diff != "" {
			Gap(t, effectFnContextualTarget, key, "chapter 7: declaration identity changed:\n%s\n%s", diff, fixed)
		}
	})
}
