// 006-data.md: a schema-error payload is effectively readonly without a redundant modifier
// rule: docs/design/src/006-data.md#c195b946ef7c743d
// 006-data.md: a schema-error payload is effectively readonly without a redundant modifier
// rule: docs/design/src/006-data.md#9af2eba338ba379d
// 006-data.md: a schema-error payload is effectively readonly without a redundant modifier
// rule: docs/design/src/006-data.md#8fcf1d81bf3392d4
// 003-failures.md: implicit readonly, explicit readonly, aliases and unprovable schemas are checked in every schema-error payload
// rule: docs/design/src/003-failures.md#56a747816bb91bf0
package vibelangfuzz

// VIP-29 requires admission checks on direct, implicitly readonly payload
// references too; nested structs already exercise the shared mapping checks.
func failuresSchemaErrorReferenceCases() []*failCase {
	const quote = "These checks apply at the mapped position, recursively in nested structs and schema errors, through aliases and unions. A conflicting or unprovable flag is `EK2109`: use an unmodified value schema and write modifiers on the declaration."
	var cases []*failCase
	for _, codec := range []struct{ name, decl string }{
		{"mutable", "const Codec = Schema.mutableKey(Schema.Number)"},
		{"optional", "const Codec = Schema.optionalKey(Schema.Number)"},
		{"alias-mutable", "const Original = Schema.mutableKey(Schema.Number); const Codec = Original"},
		{"wide", "const Codec = Schema.Number as Schema.Top"},
	} {
		for _, field := range []struct{ name, text string }{
			{"implicit", "value: ⟦Codec⟧"},
			{"readonly", "readonly value: ⟦Codec⟧"},
		} {
			cases = append(cases, &failCase{Name: "schema-error-reference-" + codec.name + "-" + field.name, Chapter: "006-data.md", Quote: quote, VIP: 29, Owner: "impl-hunt-fail", Host: "none", Code: 2109,
				Decls: codec.decl + "\nexport schema error Bad { " + field.text + " }"})
		}
	}
	return cases
}
