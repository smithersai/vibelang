package vibelangfuzz

import "strings"

// VIP-15/detail286 requires the resolved library binding, independent of its
// source spelling. Static mutations check writable/readonly container types;
// runtime Exit comparisons stay in FuzzVIPDifferential.
func dataSchemaLibraryArrayRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "Mappings preserve TypeScript mutability"
	var rules []dataRule
	for _, binding := range []struct {
		key, declaration, use string
		mutable               bool
	}{
		{"qualified-array", "", "globalThis.Array", true},
		{"qualified-readonly", "", "globalThis.ReadonlyArray", false},
		{"renamed-array", "namespace N { export import Sequence=globalThis.Array };", "N.Sequence", true},
		{"renamed-readonly", "namespace N { export import Sequence=globalThis.ReadonlyArray };", "N.Sequence", false},
		{"swapped-array", "namespace N { export import Array=globalThis.ReadonlyArray };", "N.Array", false},
		{"swapped-readonly", "namespace N { export import ReadonlyArray=globalThis.Array };", "N.ReadonlyArray", true},
	} {
		for _, position := range []struct{ key, declaration, access string }{
			{"alias", "schema S=TYPE<number>;", "s"},
			{"field", "schema S { xs:TYPE<number> }", "s.xs"},
		} {
			declaration := strings.ReplaceAll(position.declaration, "TYPE", binding.use)
			mutationCode := "TS2339"
			if binding.mutable {
				mutationCode = ""
			}
			for _, operation := range []struct{ key, body, code string }{
				{"mutation", position.access + ".push(1)", mutationCode},
				{"element", "const n:string=" + position.access + "[0]", "TS2322"},
			} {
				source := binding.declaration + " " + declaration + " function f(s:S){" + operation.body + "}"
				rules = append(rules, dataRule{"schema-library-array-" + binding.key + "-" + position.key + "-" + operation.key, chapter, quote, source, operation.code, "impl-hunt-data"})
			}
		}
	}
	return rules
}

// Keep additional mutations in the existing target's keyed byte input, rather
// than multiplying its short-run seeds. Low bits remain source trivia.
func mutateSchemaLibraryArray(source string, bits uint8) string {
	if bits&8 != 0 {
		source = strings.ReplaceAll(source, "<number>", "<number[]>")
		source = strings.ReplaceAll(source, ".push(1)", ".push([])")
	} else if bits&4 != 0 {
		source = strings.ReplaceAll(source, "<number>", "<(number)>")
	}
	if bits&16 != 0 {
		source = strings.ReplaceAll(source, "Sequence", "Seq\\u0075ence")
		source = strings.ReplaceAll(source, "Array", "Arr\\u0061y")
	}
	if bits&32 != 0 {
		source = "const Schema=1;\n" + source
	}
	return source
}
