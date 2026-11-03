package vibelangfuzz

import "fmt"

// MatchProperty: PropertyName "?"? [":" MatchPattern] (VIP-7's pinned grammar).
func dataComputedPresenceRules() []dataRule {
	const quote = "A bare key such as `{ tracking }` only tests that the property exists"
	const decl = "const key='field';const names={field:'field'} as const;const symbol=Symbol.for('field');"
	var rules []dataRule
	for i, key := range []string{`"field"`, "'field'", "1", "key", "names.field", "symbol"} {
		for j, suffix := range []string{"", ":let value"} {
			for k, source := range []string{
				"function f(x:unknown){return match(x){when {[" + key + "]" + suffix + "}:1;default:0;}}",
				"function f(x:unknown){return x is {[" + key + "]" + suffix + "}}",
				"function f(x:unknown){return match(x){when {child:{[" + key + "]" + suffix + "}}:1;default:0;}}",
				"effect function f(x:unknown){return match(x){when {[" + key + "]" + suffix + "}:1;default:0;}}",
			} {
				rules = append(rules, dataRule{fmt.Sprintf("computed-presence-%d-%d-%d", i, j, k), "006-data.md", quote, decl + source, "", "impl-hunt-data"})
			}
		}
	}
	return rules
}
