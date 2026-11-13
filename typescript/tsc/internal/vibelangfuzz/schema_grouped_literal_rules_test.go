package vibelangfuzz

func schemaGroupedLiteralRules() []dataRule {
	const quote = "Parenthesized unions within a union are flattened in source order"
	return []dataRule{
		{"schema-grouped-literals-strings", "006-data.md", quote, "schema S = (\"a\"|\"b\")|(\"c\"); const xs:readonly [\"a\",\"b\",\"c\"]=S.literals", ""},
		{"schema-grouped-literals-numbers", "006-data.md", quote, "schema S = (1|2)|(3); const xs:readonly [1,2,3]=S.literals", ""},
		{"schema-grouped-literals-mixed-literals", "006-data.md", quote, "schema S = (true|\"a\")|(2); const xs:readonly [true,\"a\",2]=S.literals", ""},
		{"schema-grouped-literals-nested", "006-data.md", quote, "schema S = (((\"a\"|\"b\")))|(\"c\"); const xs:readonly [\"a\",\"b\",\"c\"]=S.literals", ""},
		{"schema-grouped-literals-readonly-field", "006-data.md", quote, "schema S {readonly value:(\"a\"|\"b\")|(\"c\")}; const xs:readonly [\"a\",\"b\",\"c\"]=S.fields.value.literals", ""},
		{"schema-grouped-literals-all-grouped", "006-data.md", quote, "schema S = ((\"a\")|((\"b\")|(\"c\"))); const xs:readonly [\"a\",\"b\",\"c\"]=S.literals", ""},
	}
}
