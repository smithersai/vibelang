package vibelangfuzz

import "fmt"

func dataVarBindingRules() []dataRule {
	var rules []dataRule
	for _, p := range []struct{ key, subject, pattern string }{
		{"bare", "7", "%s value"},
		{"object", "({ id: 7 })", "{ id: %s value }"},
		{"shorthand", "({ value: 7 })", "{ %s value }"},
		{"array", "[7]", "[%s value]"},
		{"nested", "({ items: [7] })", "{ items: [%s value] }"},
		{"extractor", "7", "Number(%s value)"},
	} {
		for _, binding := range []string{"var", "let", "const"} {
			pattern := fmt.Sprintf(p.pattern, binding)
			for _, form := range []string{"match", "is", "arrow"} {
				var source string
				switch form {
				case "match":
					source = fmt.Sprintf("export function f(): unknown { return match (%s) { when %s: value; default: 0; } }", p.subject, pattern)
					if p.key == "bare" {
						source = "export function f(subject:boolean):unknown { return match (subject) { when " + pattern + ": value; } }"
					}
				case "is":
					source = fmt.Sprintf("export function f(): unknown { if (%s is %s) return value; return 0 }", p.subject, pattern)
				case "arrow":
					source = fmt.Sprintf("export const f = (): boolean => %s is %s", p.subject, pattern)
				}
				code := ""
				if binding == "var" {
					code = "only:EK0107"
				}
				rules = append(rules, dataRule{
					"pattern-binding-" + p.key + "-" + form + "-" + binding,
					"004-match.md",
					"Pattern bindings use `let` or `const`; `when var x:` is `EK0107`, as `var` is everywhere in `.vibe`.",
					source, code, "impl-hunt-data",
				})
			}
		}
	}
	return rules
}
