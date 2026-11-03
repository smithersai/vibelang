package vibelangfuzz

import (
	"fmt"
	"strings"
)

// VIP-7 / detail78. Diagnostics only; runtime values remain the primitive tests.
func dataPrimitiveCoverageRules() []dataRule {
	const quote = "built-in matcher and user-matcher patterns cover nothing"
	var rules []dataRule
	for _, tc := range []struct{ name, decl, typ string }{
		{"Number", "", "1|2"}, {"String", "", "\"a\"|\"b\""}, {"Boolean", "", "boolean"},
		{"BigInt", "", "1n|2n"}, {"Symbol", "declare const marker:unique symbol;", "typeof marker"},
	} {
		heads := []struct{ key, expr string }{{"direct", tc.name}}
		if tc.name == "Number" || tc.name == "String" || tc.name == "Boolean" {
			heads = append(heads, struct{ key, expr string }{"property", "globalThis." + tc.name})
		}
		for _, head := range heads {
			for _, home := range []string{"plain", "effect"} {
				for _, shape := range []string{"bare", "extractor"} {
					if head.key == "property" && shape == "extractor" {
						continue
					}
					pattern := head.expr
					if shape == "extractor" {
						pattern += "(let item)"
					}
					for _, ending := range []struct{ name, tail, code string }{
						{"missing", "", "EK4701"}, {"default", "default:0;", ""},
						{"binding", "when let rest:0;", ""},
					} {
						signature := "function f(x:" + tc.typ + ")"
						if home == "effect" {
							signature = "effect function f(x:" + tc.typ + "):number!never"
						}
						source := tc.decl + signature + " { return match(x) { when " + pattern + ":1; " + ending.tail + " } }"
						name := fmt.Sprintf("primitive-coverage-%s-%s-%s-%s-%s", strings.ToLower(tc.name), head.key, home, shape, ending.name)
						rules = append(rules, dataRule{name, "004-match.md", quote, source, ending.code, "impl-hunt-data"})
					}
				}
			}
		}
	}
	return rules
}
