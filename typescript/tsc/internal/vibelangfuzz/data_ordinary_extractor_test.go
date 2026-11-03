package vibelangfuzz

import "fmt"

// VIP-7 decided detail 100 distinguishes extractors from bare instanceof tests.
func dataOrdinaryExtractorRules() []dataRule {
	const quote = "An ordinary-class extractor without an own matcher is `EK0704`, with any argument count, including `()`"
	rules := []dataRule{
		{name: "ordinary-extractor-empty", chapter: "004-match.md", quote: quote, source: "class C {}; function f(s:unknown){return match(s){when C():1;default:0;}}", code: "only:EK0704", owner: "impl-hunt-data"},
		{name: "ordinary-extractor-binding", chapter: "004-match.md", quote: quote, source: "class C {}; function f(s:unknown){return match(s){when C(let x):1;default:0;}}", code: "only:EK0704", owner: "impl-hunt-data"},
		{name: "ordinary-extractor-alias", chapter: "004-match.md", quote: quote, source: "class Base {}; const C=Base; function f(s:unknown){return s is C()}", code: "only:EK0704", owner: "impl-hunt-data"},
		{name: "ordinary-extractor-inherited", chapter: "004-match.md", quote: "An inherited matcher does not count.", source: "import {customMatcher as key} from 'vibelang-runtime'; class Base { static [key](s:unknown){return [s]} }; class C extends Base {}; function f(s:unknown){return match(s){when C(let x):1;default:0;}}", code: "only:EK0704", owner: "impl-hunt-data"},
		{name: "ordinary-extractor-bare-control", chapter: "004-match.md", quote: "is a bare instanceof test.", source: "class C {}; function f(s:unknown){return s is C}", owner: "impl-hunt-data"},
	}
	for _, name := range []string{"String", "Number", "Boolean", "BigInt", "Symbol"} {
		rules = append(rules, dataRule{name: "ordinary-extractor-shadow-" + name, chapter: "004-match.md", quote: quote, source: fmt.Sprintf("class %s {}; function f(s:unknown){return match(s){when %s():1;default:0;}}", name, name), code: "only:EK0704", owner: "impl-hunt-data"})
	}
	return rules

}
