package vibelangfuzz

import "fmt"

// VIP-15/16 preserve native default-export expressions while assigning owning
// diagnostics to declaration forms. FuzzDataSpecRules varies leading trivia.
func dataDeclarationDiagnosticIdentityRules() []dataRule {
	const chapter = "006-data.md"
	const schemaDefault = "`export default schema S { … }` or `export default schema S = T`"
	const schemaGeneric = "type parameters on a `schema` declaration"
	const dataDefault = "`export default data D { … }`"
	var rules []dataRule
	add := func(name, quote, source, code string) {
		rules = append(rules, dataRule{"declaration-diagnostic-" + name, chapter, quote, source, code, "impl-hunt-data"})
	}
	for _, c := range []struct{ name, body string }{
		{"empty", "{}"}, {"field", "{ readonly n: number }"}, {"alias", "= number"}, {"object-alias", "= { readonly n: number }"},
	} {
		add("schema-default-"+c.name, schemaDefault, "export default schema S "+c.body, "only:EK1501")
	}
	for _, c := range []struct{ name, source string }{
		{"empty", "data D {}"}, {"unit", "data D { A; B }"}, {"field", "data D { A { readonly n: number }; B }"}, {"generic", "data D<A> { A { readonly n: A }; B }"},
	} {
		add("data-default-"+c.name, dataDefault, "export default "+c.source, "only:EK1603")
	}
	for pi, params := range []string{"A", "A, B", "A extends string", "A = string"} {
		for _, c := range []struct{ name, body string }{{"empty", "{}"}, {"field", "{ readonly n: number }"}, {"alias", "= number"}} {
			add(fmt.Sprintf("schema-parameters-%d-%s", pi, c.name), schemaGeneric, "export schema S<"+params+"> "+c.body, "only:EK1502")
		}
	}
	for _, c := range []struct{ name, source, quote string }{
		{"schema-name", "const schema = 1; export default schema", schemaDefault},
		{"schema-as", "const schema = 1; export default schema as number", schemaDefault},
		{"data-name", "const data = 1; export default data", dataDefault},
		{"data-satisfies", "const data = 1; export default data satisfies number", dataDefault},
		{"schema-named-export", "schema S { readonly n: number }; export { S as default }", schemaDefault},
		{"data-named-export", "data D<A> { V { readonly n: A } }; export { D as default }", dataDefault},
	} {
		add("valid-"+c.name, c.quote, c.source, "")
	}
	return rules
}
