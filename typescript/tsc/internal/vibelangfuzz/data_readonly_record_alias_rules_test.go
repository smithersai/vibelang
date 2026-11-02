package vibelangfuzz

// VIP-15/detail286: readonly mapping follows both resolved library bindings.
// Writes, value types and required keys distinguish a record from an unknown
// or array fallback. The canonical controls keep the known-gap boundary narrow.
func dataReadonlyRecordAliasRules() []dataRule {
	const chapter = "006-data.md"
	const quote = "selected by ordinary type lookup and alias resolution, not by spelling."
	var rules []dataRule
	for _, binding := range []struct{ key, declaration, outer, inner string }{
		{"canonical-qualified", "", "Readonly", "globalThis.Record"},
		{"canonical-renamed", "namespace N {export import Dictionary=globalThis.Record};", "Readonly", "N.Dictionary"},
		{"qualified-canonical", "", "globalThis.Readonly", "Record"},
		{"namespace-pair", "namespace N {export import Freeze=globalThis.Readonly;export import Dictionary=globalThis.Record};", "N.Freeze", "N.Dictionary"},
		{"cross-array", "namespace N {export import Array=globalThis.Record};", "Readonly", "N.Array"},
		{"cross-readonly", "namespace N {export import Readonly=globalThis.Record};", "Readonly", "N.Readonly"},
	} {
		for _, group := range []struct{ key, left, right string }{{"direct", "", ""}, {"grouped", "(", ")"}} {
			for _, operation := range []struct{ key, value, body, code string }{
				{"accept", "number", "const n:number=s.x", ""},
				{"readonly-write", "number", "s.x=1", "only:TS2540"},
				{"value-type", "number", "const n:string=s.x", "only:TS2322"},
				{"required-key", "number", "const absent:S={}", "only:TS2741"},
				{"nested-mutable", "number[]", "s.x.push(1)", ""},
			} {
				name := "schema-readonly-map-" + binding.key + "-" + group.key + "-" + operation.key
				inner := group.left + binding.inner + "<\"x\"," + operation.value + ">" + group.right
				text := binding.declaration + " schema S=" + binding.outer + "<" + inner + ">;function f(s:S){" + operation.body + "}"
				rules = append(rules, dataRule{name, chapter, quote, text, operation.code, "impl-hunt-data"})
			}
		}
	}
	for _, control := range []struct{ name, source, code string }{
		{"accept", "schema S=Readonly<Record<\"x\",number>>;function f(s:S){const n:number=s.x}", ""},
		{"readonly-write", "schema S=Readonly<Record<\"x\",number>>;function f(s:S){s.x=1}", "only:TS2540"},
		{"nested-mutable", "schema S=Readonly<Record<\"x\",number[]>>;function f(s:S){s.x.push(1)}", ""},
	} {
		rules = append(rules, dataRule{"schema-readonly-map-control-" + control.name, chapter, quote, control.source, control.code, "impl-hunt-data"})
	}
	return rules
}
