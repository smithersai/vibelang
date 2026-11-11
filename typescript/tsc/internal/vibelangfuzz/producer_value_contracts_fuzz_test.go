package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerValueTarget = "FuzzProducerValueContracts"
const producerValueQuote = "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable."
const producerValueTypeQuote = "Plain functions, `async` functions, `await`, `throw`, `using`, classes, `do` expressions and the pipe operator keep their TypeScript or pinned TC39 meaning."
const producerValueNativeQuote = "| interim `EK1002` | error: legacy compiler compatibility — a generator-based API receives a legacy producer."

func TestProducerValueContractsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerValueQuote)
	chapterSays(t, "000-intro.md", producerValueTypeQuote)
	chapterSays(t, "900-appendices.md", producerValueNativeQuote)
}

type producerValueRule struct {
	key, source, api, home       string
	accept, nativeOnly, producer bool
	wantCode                     int32
	requiredNativeCode           int32
}

// A producer is a function returning a Stream. A value contract admits that
// function by ordinary TypeScript assignability, regardless of other overloads.
func producerValueRules() []producerValueRule {
	var rules []producerValueRule
	for _, domain := range []struct{ key, typ string }{
		{"unknown", "unknown"}, {"any", "any"}, {"empty-object", "{}"}, {"object", "object"}, {"function-object", "Function"},
	} {
		prefix := "type V=" + domain.typ + ";type G=()=>Generator<number,void,unknown>;"
		value := "/** @throws {never} */ export declare function take(f:V):number;"
		generator := "/** @throws {never} */ export declare function take(f:G):number;"
		taggedValue := "/** @throws {never} */ export declare function take(tag:\"value\",f:V):number;"
		taggedGenerator := "/** @throws {never} */ export declare function take(tag:\"generator\",f:G):number;"
		for _, api := range []struct {
			key, decl, args string
			accept          bool
		}{
			{"value-first", value + generator, "ARG", true},
			{"generator-first", generator + value, "ARG", true},
			{"value-union", "/** @throws {never} */ export declare function take(f:V|G):number;", "ARG", true},
			{"prefix-value-first", taggedValue + taggedGenerator, "\"value\",ARG", true},
			{"prefix-generator-first", taggedGenerator + taggedValue, "\"value\",ARG", true},
			{"value-only", value, "ARG", true},
		} {
			for _, home := range []string{"inline", "named", "alias"} {
				for _, producer := range []bool{true, false} {
					marker, kind := "", "native"
					if producer {
						marker, kind = "effect ", "producer"
					}
					source := "import {take} from \"./api.js\";"
					arg := marker + "function*(){yield 1}"
					if home != "inline" {
						source += marker + "function* values(){yield 1};"
						arg = "values"
						if home == "alias" {
							source += "const alias=values;"
							arg = "alias"
						}
					}
					source += "export const result=take(" + strings.ReplaceAll(api.args, "ARG", arg) + ");"
					rules = append(rules, producerValueRule{key: domain.key + "-" + api.key + "-" + home + "-" + kind, source: source, api: prefix + api.decl, home: home, accept: api.accept || !producer, nativeOnly: !api.accept, producer: producer})
				}
			}
		}
	}
	for _, home := range []string{"inline", "named", "alias"} {
		for _, producer := range []bool{true, false} {
			marker, kind := "", "native"
			if producer {
				marker, kind = "effect ", "producer"
			}
			source := "import {take} from \"./api.js\";"
			arg := marker + "function*(){yield 1}"
			if home != "inline" {
				source += marker + "function* values(){yield 1};"
				arg = "values"
				if home == "alias" {
					source += "const alias=values;"
					arg = "alias"
				}
			}
			source += "export const result=take(" + arg + ");"
			rules = append(rules, producerValueRule{key: "generator-only-" + home + "-" + kind, source: source, api: "/** @throws {never} */ export declare function take(f:()=>Generator<number,void,unknown>):number;", home: home, accept: !producer, nativeOnly: true, producer: producer})
		}
	}
	for _, api := range []struct{ key, call string }{
		{"gen", "Effect.gen(ARG)"}, {"fn", "Effect.fnUntraced(ARG)"}, {"named-fn", "Effect.fn(\"read\")(ARG)"}, {"option", "Option.gen(ARG)"},
		{"fn-bad-pipeline", "Effect.fnUntraced(ARG,1)"}, {"named-fn-bad-pipeline", "Effect.fn(\"read\")(ARG,1)"},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			source := "import {Effect,Option} from \"effect\";"
			arg := "effect function*(){yield 1}"
			if home != "inline" {
				source += "effect function* values(){yield 1};"
				arg = "values"
				if home == "alias" {
					source += "const alias=values;"
					arg = "alias"
				}
			}
			source += "export const result=" + strings.ReplaceAll(api.call, "ARG", arg) + ";"
			rules = append(rules, producerValueRule{key: "native-" + api.key + "-" + home, source: source, api: "export {}", home: home, accept: false, nativeOnly: true, producer: true})
		}
	}
	for _, home := range []string{"inline", "named", "alias"} {
		source := "import {take} from \"./api.js\";"
		arg := "effect function*(){yield missing}"
		if home != "inline" {
			source += "effect function* values(){yield missing};"
			arg = "values"
			if home == "alias" {
				source += "const alias=values;"
				arg = "alias"
			}
		}
		source += "export const result=take(" + arg + ");"
		api := "/** @throws {never} */ export declare function take(f:()=>Generator<number,void,unknown>):number;/** @throws {never} */ export declare function take(f:unknown):number;"
		rules = append(rules, producerValueRule{key: "body-error-" + home, source: source, api: api, home: home, wantCode: 2304})
	}
	for _, home := range []string{"inline", "named", "alias"} {
		source := "import {Option} from \"effect\";"
		arg := "effect function*(){yield 1}"
		if home != "inline" {
			source += "effect function* values(){yield 1};"
			arg = "values"
			if home == "alias" {
				source += "const alias=values;"
				arg = "alias"
			}
		}
		valid := source + "export const result=Option.gen(" + arg + ",function*(){return yield* Option.some(1)});"
		rules = append(rules, producerValueRule{key: "native-option-self-" + home, source: valid, api: "export {}", home: home, accept: true, producer: true})
		api := "/** @throws {never} */ export declare function take(self:unknown,f:()=>Generator<number,void,unknown>):number;/** @throws {never} */ export declare function take(f:()=>Generator<number,void,unknown>):number;"
		invalid := strings.ReplaceAll(source, "import {Option} from \"effect\";", "import {take} from \"./api.js\";") + "export const result=take(" + arg + ");"
		rules = append(rules, producerValueRule{key: "missing-callback-" + home, source: invalid, api: api, home: home, accept: false, nativeOnly: true, producer: true})
	}
	for _, api := range []struct {
		key, decl, call string
		accept          bool
		nativeCode      int32
	}{
		{"variadic-tail", "/** @throws {never} */ export declare function take(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function take(f:G):number;", "take(ARG)", true, 0},
		{"variadic-tail-prefix", "/** @throws {never} */ export declare function take(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function take(prefix:number,f:G):number;", "take(1,ARG)", true, 0},
		{"variadic-prefix", "/** @throws {never} */ export declare function take(f:unknown,...args:[...number[],()=>void]):number;/** @throws {never} */ export declare function take(f:G,done:()=>void):number;", "take(ARG,()=>{})", true, 0},
		{"variadic-middle", "/** @throws {never} */ export declare function take(...args:[...number[],unknown,()=>void]):number;/** @throws {never} */ export declare function take(prefix:number,f:G,done:()=>void):number;", "take(1,ARG,()=>{})", true, 0},
		{"optional-metadata", "/** @throws {never} */ export declare function take(tag?:number,f?:unknown):number;/** @throws {never} */ export declare function take(tag:number|undefined,f:G):number;", "take(undefined,ARG)", true, 0},
		{"optional-tuple", "/** @throws {never} */ export declare function take(...args:[tag?:number,f?:unknown]):number;/** @throws {never} */ export declare function take(tag:number|undefined,f:G):number;", "take(undefined,ARG)", true, 0},
		{"void-metadata", "/** @throws {never} */ export declare function take(f:unknown,unused:void):number;/** @throws {never} */ export declare function take(f:G):number;", "take(ARG)", true, 0},
		{"spread-array", "/** @throws {never} */ export declare function take(f:unknown,...meta:number[]):number;/** @throws {never} */ export declare function take(f:G,...meta:number[]):number;", "take(ARG,...[1,2])", true, 0},
		{"spread-tuple", "/** @throws {never} */ export declare function take(f:unknown,n:number):number;/** @throws {never} */ export declare function take(f:G,n:number):number;", "take(ARG,...([1] as const))", true, 0},
		{"spread-before", "/** @throws {never} */ export declare function take(n:number,f:unknown):number;/** @throws {never} */ export declare function take(n:number,f:G):number;", "take(...([1] as const),ARG)", true, 0},
		{"tagged-generator", "/** @throws {never} */ export declare function take(tag:\"value\",f:unknown):number;/** @throws {never} */ export declare function take(tag:\"generator\",f:G):number;", "take(\"generator\",ARG)", false, 0},
		{"generic-value", "/** @throws {never} */ export declare function take<F extends object>(f:F):number;/** @throws {never} */ export declare function take(f:G):number;", "take(ARG)", true, 0},
		{"generic-value-explicit", "/** @throws {never} */ export declare function take<F>(f:F):number;/** @throws {never} */ export declare function take(f:G):number;", "take<unknown>(ARG)", true, 0},
		{"invalid-type-constraint", "/** @throws {never} */ export declare function take<F extends G>(f:F):number;", "take<()=>Stream.Stream<number>>(ARG)", false, 2344},
		{"invalid-type-arity", "/** @throws {never} */ export declare function take(f:G):number;", "take<number,string>(ARG)", false, 2558},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			for _, producer := range []bool{true, false} {
				marker, kind := "", "native"
				if producer {
					marker, kind = "effect ", "producer"
				}
				source := "import {take} from \"./api.js\";"
				arg := marker + "function*(){yield 1}"
				if home != "inline" {
					source += marker + "function* values(){yield 1};"
					arg = "values"
					if home == "alias" {
						source += "const alias=values;"
						arg = "alias"
					}
				}
				source += "export const result=" + strings.ReplaceAll(api.call, "ARG", arg) + ";"
				accept := api.accept || !producer
				if api.nativeCode != 0 {
					accept = false
				}
				rules = append(rules, producerValueRule{key: api.key + "-" + home + "-" + kind, source: source, api: "type G=()=>Generator<number,void,unknown>;" + api.decl, home: home, accept: accept, nativeOnly: !api.accept && api.nativeCode == 0, producer: producer, requiredNativeCode: api.nativeCode})
			}
		}
	}
	for _, api := range []struct {
		key, call string
		accept    bool
	}{
		{"option-spread-self", "Option.gen(ARG,...([function*(){return yield* Option.some(1)}] as const))", true},
		{"option-spread-empty", "Option.gen(ARG,...([] as const))", false},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			source := "import {Option} from \"effect\";"
			arg := "effect function*(){yield 1}"
			if home != "inline" {
				source += "effect function* values(){yield 1};"
				arg = "values"
				if home == "alias" {
					source += "const alias=values;"
					arg = "alias"
				}
			}
			source += "export const result=" + strings.ReplaceAll(api.call, "ARG", arg) + ";"
			rules = append(rules, producerValueRule{key: api.key + "-" + home, source: source, api: "export {}", home: home, accept: api.accept, nativeOnly: !api.accept, producer: true})
		}
	}
	return rules
}

func FuzzProducerValueContracts(f *testing.F) {
	startShortBudget(f)
	rules := producerValueRules()
	for i, r := range rules {
		f.Add(r.key, uint8(i%4))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestProducerValueContractsQuoted(t)
		i := slices.IndexFunc(rules, func(r producerValueRule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* value contract */\n", int(trivia)%4) + r.source
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
		if r.wantCode != 0 {
			if len(codes) != 1 || codes[0] != r.wantCode {
				Gap(t, producerValueTarget, r.key, "%s; want native diagnostic %d, got %v\n%s\n%s", producerValueTypeQuote, r.wantCode, codes, source, r.api)
			}
		} else if (len(codes) == 0) != r.accept {
			Gap(t, producerValueTarget, r.key, "%s; %s; accept=%t, got %v\n%s\n%s", producerValueQuote, producerValueTypeQuote, r.accept, codes, source, r.api)
		}
		if !r.accept && r.nativeOnly && r.producer && r.home != "alias" && !slices.Contains(codes, int32(1002)) {
			Gap(t, producerValueTarget, r.key, "native generator rejection must retain EK1002, got %v\n%s", codes, source)
		}
		if r.requiredNativeCode != 0 && !slices.Contains(codes, r.requiredNativeCode) {
			Gap(t, producerValueTarget, r.key, "native type-argument diagnostic %d must remain, got %v", r.requiredNativeCode, codes)
		}
		ExpectPending(t, producerValueTarget, r.key)
		ExpectPending(t, producerValueTarget, specCorpusKey(t))
	})
}
