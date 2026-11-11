package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerCallbackTarget = "FuzzProducerCompatibleCallbacks"
const producerCallbackQuote = "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable."
const producerCallbackTypeQuote = "Plain functions, `async` functions, `await`, `throw`, `using`, classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning."
const producerNativeCallbackQuote = "| interim `EK1002` | error: legacy compiler compatibility — a generator-based API receives a legacy producer."

func TestProducerCompatibleCallbacksQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerCallbackQuote)
	chapterSays(t, "000-intro.md", producerCallbackTypeQuote)
	chapterSays(t, "900-appendices.md", producerNativeCallbackQuote)
}

type producerCallbackRule struct {
	key, source, api             string
	accept, nativeOnly, producer bool
	home                         string
}

// The Stream counterpart has the same callback signature. Overloads and unions
// do not change a written producer into a native generator. Conversely, a
// native-generator-only API still rejects an explicit producer.
func producerCallbackRules() []producerCallbackRule {
	var rules []producerCallbackRule
	for _, parameter := range []struct{ key, decl, value string }{
		{"none", "", "1"},
		{"required", "n:number", "n"},
		{"optional", "n?:number", "(n ?? 1)"},
		{"rest", "...n:number[]", "(n[0] ?? 1)"},
	} {
		sf := "(" + parameter.decl + ")=>Stream.Stream<number>"
		gf := "(" + parameter.decl + ")=>Generator<number,void,unknown>"
		stream := "/** @throws {never} */ export declare function take(f:S):number;"
		generator := "/** @throws {never} */ export declare function take(f:G):number;"
		prefix := "import {Stream} from \"effect\";type S=" + sf + ";type G=" + gf + ";"
		for _, api := range []struct {
			key, decl         string
			stream, generator bool
		}{
			{"stream-first", stream + generator, true, true},
			{"generator-first", generator + stream, true, true},
			{"callable-union", "/** @throws {never} */ export declare function take(f:S|G):number;", true, true},
			{"return-union", "/** @throws {never} */ export declare function take(f:(" + parameter.decl + ")=>Stream.Stream<number>|Generator<number,void,unknown>):number;", true, true},
			{"generic-return-union", "/** @throws {never} */ export declare function take<A>(f:(" + parameter.decl + ")=>Stream.Stream<A>|Generator<A,void,unknown>):number;", true, true},
			{"aliased-union", "type Either=S|G;/** @throws {never} */ export declare function take(f:Either):number;", true, true},
			{"stream-only", stream, true, false},
			{"generator-only", generator, false, true},
		} {
			for _, home := range []string{"inline", "named", "alias"} {
				for _, producer := range []bool{true, false} {
					marker, kind := "", "native"
					if producer {
						marker, kind = "effect ", "producer"
					}
					source := "import {take} from \"./api.js\";"
					arg := marker + "function*(" + parameter.decl + "){yield " + parameter.value + "}"
					if home != "inline" {
						source += marker + "function* values(" + parameter.decl + "){yield " + parameter.value + "};"
						arg = "values"
						if home == "alias" {
							source += "const alias=values;"
							arg = "alias"
						}
					}
					source += "export const result=take(" + arg + ");"
					accept := api.generator
					if producer {
						accept = api.stream
					}
					rules = append(rules, producerCallbackRule{
						key: api.key + "-" + parameter.key + "-" + home + "-" + kind, source: source, api: prefix + api.decl,
						accept: accept, nativeOnly: !api.stream, producer: producer, home: home,
					})
				}
			}
		}
	}
	for _, api := range []struct{ key, call string }{
		{"gen", "Effect.gen(ARG)"}, {"fn", "Effect.fnUntraced(ARG)"}, {"named-fn", "Effect.fn(\"read\")(ARG)"},
		{"option-gen", "Option.gen(ARG)"},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			for _, producer := range []bool{true, false} {
				marker, kind, body := "", "native", "yield* Effect.void"
				if api.key == "option-gen" {
					body = "yield* Option.some(1)"
				}
				if producer {
					marker, kind, body = "effect ", "producer", "yield 1"
				}
				source := "import {Effect, Option} from \"effect\";"
				arg := marker + "function*(){" + body + "}"
				if home != "inline" {
					source += marker + "function* values(){" + body + "};"
					arg = "values"
					if home == "alias" {
						source += "const alias=values;"
						arg = "alias"
					}
				}
				source += "export const result=" + strings.ReplaceAll(api.call, "ARG", arg) + ";"
				rules = append(rules, producerCallbackRule{
					key: "native-" + api.key + "-" + home + "-" + kind, source: source, api: "export {}",
					accept: !producer, nativeOnly: true, producer: producer, home: home,
				})
			}
		}
	}
	return rules
}

func FuzzProducerCompatibleCallbacks(f *testing.F) {
	startShortBudget(f)
	rules := producerCallbackRules()
	for i, r := range rules {
		f.Add(r.key, uint8(i%4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestProducerCompatibleCallbacksQuoted(t)
		i := slices.IndexFunc(rules, func(r producerCallbackRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* callback contract */\n", int(trivia)%4) + r.source
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "api.ts": r.api}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		if (len(codes) == 0) != r.accept {
			Gap(t, producerCallbackTarget, r.key, "%s; %s; accept=%t, diagnostics=%v\n%s\n%s", producerCallbackQuote, producerCallbackTypeQuote, r.accept, codes, source, r.api)
		}
		if !r.accept && r.nativeOnly && r.producer && r.home != "alias" && !slices.Contains(codes, int32(1002)) {
			Gap(t, producerCallbackTarget, r.key, "a native generator API must retain its producer mismatch; got %v\n%s", codes, source)
		}
		ExpectPending(t, producerCallbackTarget, r.key)
		ExpectPending(t, producerCallbackTarget, specCorpusKey(t))
	})
}
