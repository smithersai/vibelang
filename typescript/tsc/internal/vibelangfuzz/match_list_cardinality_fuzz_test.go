package vibelangfuzz

// Runtime semantics stay in VIP-7's canonical differential witnesses.
// These neighbors test grammar admission; optional bindings remain a known gap.
func dataListPatternGrammarRules() []dataRule {
	const elision = "Each `Elision` consumes its full number of commas, excluding a list-separator comma."
	const optional = "An absent optional element consumes zero values, leaves the iterator done and the actual index unchanged, and does not run its sub-pattern or initialize its bindings."
	var rules []dataRule
	for _, p := range []struct{ key, text, quote string }{
		{"double-elision", "[,,1]", elision},
		{"double-elision-rest", "[,,1,...]", elision},
		{"elision-only", "[,]", elision},
		{"trailing-elision", "[1,,]", elision},
		{"trailing-elision-rest", "[1,,...]", elision},
		{"optional-pair", "[1?,2?]", optional},
		{"optional-before-required", "[1?,2]", optional},
		{"required-before-optional", "[1,2?]", optional},
		{"optional-elision-optional", "[2?,,1?]", optional},
		{"empty-control", "[]", elision},
		{"rest-control", "[...]", elision},
	} {
		for _, form := range []string{"match", "is", "effect", "nested"} {
			expression := "match(s){when " + p.text + ":true;default:false;}"
			source := "function f(s:readonly number[]){return " + expression + "}"
			switch form {
			case "is":
				source = "function f(s:readonly number[]){return s is " + p.text + "}"
			case "effect":
				source = "effect function f(s:readonly number[]){return " + expression + "}"
			case "nested":
				source = "function f(s:{items:readonly number[]}){return match(s){when {items:" + p.text + "}:true;default:false;}}"
			}
			key := "list-grammar-" + p.key + "-" + form
			rules = append(rules, dataRule{key, "004-match.md", p.quote, source, ""})

		}
	}
	return rules
}
