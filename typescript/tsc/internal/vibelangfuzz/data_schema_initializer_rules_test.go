package vibelangfuzz

import "strings"

// Chapter 006 shares the Appendix's Field production; it has a type and a
// separator, with no initializer. The repair must keep the mapped field.
func dataSchemaInitializerRules() []dataRule {
	const chapter = "900-appendices.md"
	const quote = "Field = \"readonly\"? PropertyName \"?\"? \":\" Type Separator"
	var rules []dataRule
	for _, home := range []struct{ key, source string }{
		{"struct", "schema S { %FIELD% }"},
		{"alias", "schema S = { %FIELD% }"},
		{"nested", "schema S { readonly child: { %FIELD% } }"},
		{"namespace", "namespace N { export schema S { %FIELD% } }"},
		{"error-nested", "schema error Outer { readonly child: { %FIELD% } }"},
	} {
		for _, field := range []struct{ key, source string }{
			{"required", "value: number"},
			{"readonly", "readonly value: number"},
			{"optional", "readonly value?: number"},
		} {
			for _, expr := range []struct{ key, source string }{
				{"literal", "42"},
				{"call", "(() => 42)()"},
				{"comment", "/* keep */ (1 + 2)"},
			} {
				source := strings.Replace(home.source, "%FIELD%", field.source+" = "+expr.source+";", 1)
				rules = append(rules, dataRule{"schema-initializer-" + home.key + "-" + field.key + "-" + expr.key, chapter, quote, source, "only:TS1247", "impl-hunt-data"})
			}
			source := strings.Replace(home.source, "%FIELD%", field.source+";", 1)
			rules = append(rules, dataRule{"schema-initializer-" + home.key + "-" + field.key + "-valid", chapter, quote, source, "", "impl-hunt-data"})
		}
	}
	return rules
}
