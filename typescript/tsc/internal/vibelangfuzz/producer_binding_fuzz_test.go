package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 3 binds an Effect callable's parameters at the call and never lets
// the call throw. The quote is read from the chapter at test time. The native
// oracle is an async function with the same parameter list: ECMA-262
// EvaluateAsyncFunctionBody turns a throw while binding into a rejection, so
// the producer's Stream must die with the same kind of value exactly when the
// twin rejects, and run otherwise. The generator draws parameter lists from
// identifiers, object and array patterns, nesting and defaults, and arguments
// from values that make binding throw (undefined, null, a number, a throwing
// getter) or succeed.
var producerBindingQuote = "a producer's gives a `Stream` that dies with it, as an `async` function rejects. The call itself never throws."

// Each parameter is a binding and its default, if any.
var producerBindingParams = [][2]string{{"a", ""}, {"{ a }", ""}, {"{ a: { b } }", ""}, {"[a]", ""}, {"a", "1"}, {"{ a }", "{}"}, {"{ a = 2 }", ""}, {"[a]", "[]"}, {"{ [key()]: a }", ""}}

// Parameter i binds a<i> and b<i>, so the objects name every parameter's keys.
var producerBindingArgs = []string{"undefined", "null", "5", "{}", "{ a0: { b0: 1 }, a1: { b1: 1 }, a2: { b2: 1 } }", "[1]", "throwing", "{ k: 1 }"}

func producerBindingChapter(tb testing.TB) {
	if !strings.Contains(SpecText("003-failures.md"), producerBindingQuote) {
		tb.Fatalf("chapter 3 no longer says %q", producerBindingQuote)
	}
}

func TestProducerBindingQuoted(t *testing.T) { producerBindingChapter(t) }

const producerBindingProbe = `import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"

const key = () => "k"
const fail = (): never => { throw new RangeError("getter") }
const throwing = { get a0() { return fail() }, get a1() { return fail() }, get a2() { return fail() }, get k() { return fail() } }
void throwing
async function native(%s) { return 0 }
const twin = native as (...xs: unknown[]) => Promise<unknown>
const name = (value: unknown) => value instanceof Error ? value.constructor.name : typeof value

export function main() {
  return Effect.promise(async () => {
    // A computed specifier: the compiled main.js stands beside this file in out/.
    const { p } = await import(["./main", "js"].join("."))
    const args: unknown[] = [%s]
    let stream: unknown
    try {
      stream = (p as (...xs: unknown[]) => unknown)(...args)
    } catch (error) {
      return ["throw:" + name(error), await twin(...args).then(() => "ok", e => "reject:" + name(e))]
    }
    const exit = await Effect.runPromiseExit(Stream.runCollect(stream as Stream.Stream<unknown, unknown>))
    const got = Exit.isSuccess(exit) ? "ok" : exit.cause.reasons[0]._tag === "Die" ? "reject:" + name((exit.cause.reasons[0] as { defect: unknown }).defect) : "other"
    const want = await twin(...args).then(() => "ok", e => "reject:" + name(e))
    return [got, want]
  })
}
`

func FuzzProducerBinding(f *testing.F) {
	startShortBudget(f)
	producerBindingChapter(f)
	seeds := map[string][2][]int{
		"object-undefined":   {{1}, {0}},
		"object-getter":      {{1}, {6}},
		"nested-empty":       {{2}, {3}},
		"array-number":       {{3}, {2}},
		"default-null":       {{5}, {1}},
		"inner-default":      {{6}, {0}},
		"array-default-ok":   {{7}, {0}},
		"computed-getter":    {{8}, {6}},
		"second-of-two":      {{0, 1}, {2, 0}},
		"identifiers-only":   {{0, 4}, {0, 1}},
		"three-mixed-values": {{1, 3, 4}, {4, 5, 2}},
	}
	for key := range seeds {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "%v", err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, data []byte) {
		var params, args []int
		if seed, ok := seeds[string(data)]; ok {
			params, args = seed[0], seed[1]
		} else {
			for i := 0; i+1 < len(data) && len(params) < 3; i += 2 {
				params = append(params, int(data[i])%len(producerBindingParams))
				args = append(args, int(data[i+1])%len(producerBindingArgs))
			}
			if len(params) == 0 {
				params, args = []int{1}, []int{0}
			}
		}
		var paramList, argList, typed []string
		for i, p := range params {
			binding := strings.NewReplacer("a", fmt.Sprintf("a%d", i), "b", fmt.Sprintf("b%d", i)).Replace(producerBindingParams[p][0])
			param := binding + ": any"
			if def := producerBindingParams[p][1]; def != "" {
				param += " = " + def
			}
			paramList = append(paramList, binding)
			typed = append(typed, param)
			argList = append(argList, producerBindingArgs[args[i]])
		}
		vibe := "function key(): string { return \"k\" }\nexport effect function* p(" + strings.Join(typed, ", ") + ") { yield 0 }\n"
		probe := fmt.Sprintf(producerBindingProbe, strings.Join(typed, ", "), strings.Join(argList, ", "))
		files := map[string]string{"main.vibe": vibe, "probe.ts": probe}
		r, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
			}
		}
		if len(errors) > 0 {
			Gap(t, "FuzzProducerBinding", "control", "a producer with parameters %s does not compile:\n%s\n%s", strings.Join(paramList, ", "), vibe, strings.Join(errors, "\n"))
			return
		}
		got := node.Run(r, "out/probe.js", "main")
		var pair []string
		if got.Kind != "success" || json.Unmarshal(got.Value, &pair) != nil || len(pair) != 2 {
			Gap(t, "FuzzProducerBinding", "probe", "the probe did not run: %s %s %s\n%s", got.Kind, got.Value, got.Log, vibe)
			return
		}
		if strings.HasPrefix(pair[0], "throw:") {
			Gap(t, "FuzzProducerBinding", "call-throws", "chapter 3: %s; p(%s) threw (%s; the async twin gives %s):\n%s", producerBindingQuote, strings.Join(argList, ", "), pair[0], pair[1], vibe)
			return
		}
		if pair[0] != pair[1] {
			Gap(t, "FuzzProducerBinding", "outcome", "chapter 3: %s; p(%s) gives %s, the async twin %s:\n%s", producerBindingQuote, strings.Join(argList, ", "), pair[0], pair[1], vibe)
			return
		}
		if !slices.Contains([]string{"ok", "reject:TypeError", "reject:RangeError"}, pair[0]) {
			t.Logf("unexpected outcome %s for %s", pair[0], vibe)
		}
		ExpectPending(t, "FuzzProducerBinding", "control")
		ExpectPending(t, "FuzzProducerBinding", "probe")
		ExpectPending(t, "FuzzProducerBinding", "call-throws")
		ExpectPending(t, "FuzzProducerBinding", "outcome")
	})
}
