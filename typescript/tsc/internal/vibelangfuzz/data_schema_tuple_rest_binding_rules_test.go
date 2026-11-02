package vibelangfuzz

import "strings"

// VIP-15/detail286 applies the library-binding rule inside tuple rests too.
// These are static type and grammar oracles; runtime Exits use the paired case.
func dataSchemaTupleRestBindingRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "selected by ordinary type lookup and alias resolution, not by spelling."
	const nativeGrammarQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
	var rules []dataRule
	for _, binding := range []struct{ key, decl, use string }{
		{"qualified-array", "", "globalThis.Array"},
		{"qualified-readonly", "", "globalThis.ReadonlyArray"},
		{"renamed-array", "namespace N {export import Sequence=globalThis.Array};", "N.Sequence"},
		{"swapped-readonly", "namespace N {export import Array=globalThis.ReadonlyArray};", "N.Array"},
	} {
		for _, shape := range []struct{ key, tuple string }{
			{"rest", "[...REST]"}, {"label", "[...items:REST]"}, {"nested-tail", "[...[...REST],boolean]"},
		} {
			for _, readonly := range []bool{false, true} {
				key := binding.key + "-" + shape.key
				tuple := strings.ReplaceAll(shape.tuple, "REST", binding.use+"<number>")
				body := "const x: number | boolean = s[0]"
				if readonly {
					key += "-readonly"
					tuple = "readonly " + tuple
				} else {
					key += "-mutable"
					body += ";s.push(1)"
				}
				source := binding.decl + "schema S=" + tuple + ";function f(s:S){" + body + "}"
				rules = append(rules, dataRule{"schema-tuple-rest-binding-" + key, chapter, quote, source, "", "impl-hunt-data"})
			}
		}
		for _, shape := range []struct{ key, tuple string }{
			{"two-rests", "readonly [...REST,...REST]"},
			{"optional-after-rest", "readonly [...REST,string?]"},
		} {
			source := binding.decl + "schema S=" + strings.ReplaceAll(shape.tuple, "REST", binding.use+"<number>")
			rules = append(rules, dataRule{"schema-tuple-rest-binding-" + binding.key + "-" + shape.key, "000-intro.md", nativeGrammarQuote, source, "error", "impl-hunt-data"})
		}
	}
	for _, binding := range []struct{ key, decl, use string }{
		{"local-array", "type Array<T>={value:T};", "Array"},
		{"local-readonly", "type ReadonlyArray<T>={value:T};", "ReadonlyArray"},
		{"renamed-local", "namespace N {export type Sequence<T>={value:T}};", "N.Sequence"},
		{"schema-value", "const Sequence=Schema.Number;", "Sequence"},
	} {
		for _, shape := range []struct{ key, tuple string }{
			{"rest", "[...REST]"}, {"label", "[...items:REST]"}, {"nested-tail", "readonly [...[...REST],boolean]"},
		} {
			source := binding.decl + "schema S=" + strings.ReplaceAll(shape.tuple, "REST", binding.use+"<number>")
			rules = append(rules, dataRule{"schema-tuple-rest-binding-" + binding.key + "-" + shape.key, chapter, quote, source, "only:EK2109", "impl-hunt-data"})
		}
	}
	return rules
}

func mutateSchemaTupleRestBinding(source string, bits uint8) string {
	if bits&4 != 0 {
		source = strings.ReplaceAll(source, "<number>", "<(number)>")
	}
	if bits&8 != 0 {
		source = strings.ReplaceAll(source, "Array", "Arr\\u0061y")
	}
	if bits&16 != 0 && !strings.Contains(source, "Schema.") {
		source = "const Schema=1;\n" + source
	}
	return source
}
