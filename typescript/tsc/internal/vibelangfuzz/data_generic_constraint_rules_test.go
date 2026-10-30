package vibelangfuzz

import "strings"

// Chapter 4 projects only exhaustiveness coverage through a generic's base
// constraint. Arm/default typing continues to follow TypeScript flow.
func dataGenericConstraintRules() []dataRule {
	const chapter = "004-match.md"
	const quote = "A constrained type parameter uses its finite constraint as a conservative domain; an unconstrained parameter or a broad constraint stays open."
	var rules []dataRule
	for _, domain := range []struct{ key, parameters, first, second string }{
		{"letters", "T extends 'A' | 'B'", "'A'", "'B'"},
		{"numbers", "T extends 1 | 2", "1", "2"},
		{"boolean", "T extends boolean", "true", "false"},
		{"tags", "T extends { _tag: 'A' } | { _tag: 'B' }", "{ _tag: 'A' }", "{ _tag: 'B' }"},
		{"indirect", "U extends 1 | 2, T extends U", "1", "2"},
	} {
		for _, arms := range []struct{ key, tail, code string }{
			{"missing", "", "only:EK4701"},
			{"complete", "when SECOND: 2;", ""},
			{"default", "default: 0;", ""},
		} {
			source := "function f<" + domain.parameters + ">(x:T) { return match(x) { when " + domain.first + ": 1; " + strings.ReplaceAll(arms.tail, "SECOND", domain.second) + " } }"
			rules = append(rules, dataRule{"exhaustive-generic-" + domain.key + "-" + arms.key, chapter, quote, source, arms.code, "impl-hunt-data"})
		}
	}
	for _, open := range []struct{ key, parameters string }{
		{"unconstrained", "T"},
		{"string", "T extends string"},
		{"number", "T extends number"},
		{"mixed", "T extends 'A' | { count: number }"},
	} {
		source := "function f<" + open.parameters + ">(x:T) { return match(x) { when let item and if(false): 0; } }"
		rules = append(rules, dataRule{"exhaustive-generic-open-" + open.key, chapter, quote, source, "", "impl-hunt-data"})
	}
	for _, typ := range []struct{ key, source, code string }{
		{"void", "void", ""},
		{"void-union", "void | true", ""},
		{"undefined", "undefined", "only:EK4701"},
		{"undefined-union", "undefined | true", "only:EK4701"},
	} {
		source := "function f(x:" + typ.source + ") { return match(x) { when let item and if(false): 0; } }"
		rules = append(rules, dataRule{"exhaustive-domain-" + typ.key, chapter, "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source, typ.code, "impl-hunt-data"})
	}
	return rules
}
