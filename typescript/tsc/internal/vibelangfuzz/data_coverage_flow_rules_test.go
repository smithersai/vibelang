package vibelangfuzz

// VIP-7 keeps ordinary subject typing independent from coverage. The arm
// expression and default assert the native true/false types as well as EK4701.
func dataCoverageFlowRules() []dataRule {
	const quote = "`and`, `not`, regex, relational, array, built-in matcher and user-matcher patterns cover nothing"
	var rules []dataRule
	for _, p := range []struct{ key, pattern string }{
		{"and", "true and true"},
		{"not", "not false"},
		{"and-or", "true and (true or false)"},
		{"or-and", "(true or false) and true"},
		{"not-and", "not (false and false)"},
		{"not-not", "not (not true)"},
		{"and-not", "true and (not false)"},
		{"not-and-true", "(not false) and true"},
	} {
		for _, context := range []string{"plain", "effect", "loop"} {
			for _, fallback := range []bool{false, true} {
				tail, code, key := "when false: 0;", "only:EK4701", "missing"
				if fallback {
					tail, code, key = "default: (x satisfies false) ? 0 : 0;", "", "default"
				}
				if p.key == "and-not" {
					code = "only:TS2367"
					if !fallback {
						code = "only:EK4701,TS2367"
					}
				}
				expression := "match(x){when " + p.pattern + ": (x satisfies true) ? 1 : 1; " + tail + "}"
				source := "export function f(x:boolean):number{return " + expression + ";}"
				if context == "effect" {
					source = "export effect function f(x:boolean){return " + expression + ";}"
				}
				if context == "loop" {
					source = "export function f(x:boolean):number{for(let i=0;i<1;i++){return " + expression + ";} return 0;}"
				}
				rules = append(rules, dataRule{"coverage-flow-" + p.key + "-" + context + "-" + key, "004-match.md", quote, source, code, "impl-hunt-data"})
			}
		}
	}
	rules = append(rules, dataRule{
		"coverage-flow-covered-native", "004-match.md", quote,
		"export function f(x:boolean){return match(x){when true and true:1;when true:2;when false:0;}}",
		"only:TS2367", "impl-hunt-data",
	})
	return rules
}
