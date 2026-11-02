package vibelangfuzz

import "strings"

// VIP-15, detail 286. The direct/imported matrix is owned by
// FuzzSchemaMappedBinding; these rules cover nested lexical homes, erased
// schema-error field types and escaped source names around the same defect.
func dataSchemaBindingScopeRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "A reference names a Schema value, not an expanded TypeScript type alias, interface, enum or class."
	var rules []dataRule
	for _, builtin := range []struct{ key, name, declaration, use, escaped string }{
		{"array", "Array", "type Array<T> = { value: T };", "Array<number>", "Arr\\u0061y<number>"},
		{"readonlyarray", "ReadonlyArray", "type ReadonlyArray<T> = { value: T };", "ReadonlyArray<number>", "ReadonlyArr\\u0061y<number>"},
		{"record", "Record", "type Record<K,V> = { key: K; value: V };", "Record<string,number>", "Rec\\u006frd<string,number>"},
		{"readonly", "Readonly", "type Readonly<T> = { wrapped: T };", "Readonly<Record<string,number>>", "Read\\u006fnly<Record<string,number>>"},
	} {
		for _, home := range []struct{ key, prefix, suffix, body, code string }{
			{"namespace", "namespace N { ", " }", "schema S { field: { nested: USE } }", "EK2109"},
			{"function", "function f() { ", " return S; }", "schema S = USE;", "EK2109"},
			{"error-escaped", "namespace N { ", " }", "schema error Bad { value: ESCAPED }", "EK2109"},
			{"value-only", "namespace N { ", " }", "schema S = USE;", ""},
			{"scope-exit", "namespace N { ", " } schema S = USE;", "", ""},
		} {
			declaration := builtin.declaration
			if home.key == "value-only" {
				declaration = "const " + builtin.name + " = 1;"
			}
			source := home.prefix + declaration + " " + home.body + home.suffix
			source = strings.ReplaceAll(source, "USE", builtin.use)
			source = strings.ReplaceAll(source, "ESCAPED", builtin.escaped)
			rules = append(rules, dataRule{"schema-binding-scope-" + builtin.key + "-" + home.key, chapter, quote, source, home.code, "impl-hunt-data"})
		}
	}
	return rules
}
