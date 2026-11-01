package vibelangfuzz

import "strings"

// VIP-15/detail286: use the resolved library binding and retain Record's
// writable decoded keys, including inside a shallow readonly field.
func dataSchemaLibraryRecordRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "selected by ordinary type lookup and alias resolution, not by spelling."
	var rules []dataRule
	for _, binding := range []struct{ key, declaration, use string }{
		{"qualified", "", "globalThis.Record"},
		{"renamed", "namespace N { export import Dictionary=globalThis.Record };", "N.Dictionary"},
		{"array-spelling", "namespace N { export import Array=globalThis.Record };", "N.Array"},
		{"readonly-spelling", "namespace N { export import Readonly=globalThis.Record };", "N.Readonly"},
	} {
		for _, position := range []struct{ key, declaration, access string }{
			{"alias", "schema S=TYPE<\"x\",number>;", "s"},
			{"field", "schema S { entries:TYPE<\"x\",number> }", "s.entries"},
			{"shallow-readonly", "schema S { readonly entries:TYPE<\"x\",number> }", "s.entries"},
		} {
			declaration := strings.ReplaceAll(position.declaration, "TYPE", binding.use)
			for _, operation := range []struct{ key, body, code string }{
				{"write", position.access + ".x=1", ""},
				{"value", "const n:string=" + position.access + ".x", "TS2322"},
			} {
				source := binding.declaration + " " + declaration + " function f(s:S){" + operation.body + "}"
				rules = append(rules, dataRule{"schema-library-record-" + binding.key + "-" + position.key + "-" + operation.key, chapter, quote, source, operation.code, "impl-hunt-data"})
			}
		}
	}
	rules = append(rules,
		dataRule{"schema-library-record-value-only", chapter, quote, "const Record=1; schema S=Record<\"x\",number>; function f(s:S){s.x=1}", "", "impl-hunt-data"},
		dataRule{"schema-library-record-custom-type", chapter, quote, "type Record<K,V>={key:K;value:V}; schema S=Record<string,number>", "EK2109", "impl-hunt-data"},
		dataRule{"schema-library-record-wrong-arity", chapter, quote, "schema S=globalThis.Record<string>", "EK2109", "impl-hunt-data"},
		dataRule{"schema-library-readonly-record-alias", chapter, quote, "namespace N { export import Freeze=globalThis.Readonly; export import Dictionary=globalThis.Record }; schema S=N.Freeze<N.Dictionary<\"x\",number>>; function f(s:S){const n:number=s.x}", "", "impl-hunt-data"},
	)
	return rules
}

func mutateSchemaLibraryRecord(source string, bits uint8) string {
	if bits&8 != 0 && strings.Contains(source, "<\"x\",number>") {
		source = strings.ReplaceAll(source, "<\"x\",number>", "<\"x\",number[]>")
		source = strings.ReplaceAll(source, ".x=1", ".x=[1]")
	} else if bits&4 != 0 {
		source = strings.ReplaceAll(source, "<\"x\",number>", "<\"x\",(number)>")
	}
	if bits&16 != 0 {
		source = strings.ReplaceAll(source, "Dictionary", "Diction\\u0061ry")
		source = strings.ReplaceAll(source, "Record", "Rec\\u006frd")
	}
	if bits&32 != 0 {
		source = "const Schema=1;\n" + source
	}
	return source
}
