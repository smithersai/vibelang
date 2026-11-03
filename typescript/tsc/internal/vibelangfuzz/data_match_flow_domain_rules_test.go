package vibelangfuzz

// Static coverage only: VIP-7's refined-domain amendment. Runtime matching is
// unchanged; the diagnostic starts from TypeScript's type at evaluation.
func dataMatchFlowDomainRules() []dataRule {
	const quote = "Start from TypeScript's type of the subject expression at that evaluation point, including its represented flow refinements."
	var rules []dataRule
	for _, input := range []struct{ key, parameters, prefix, subject string }{
		{"boolean", "x:boolean|number", `if(typeof x!=="boolean")return 0;`, "x"},
		{"unknown", "x:unknown", `if(typeof x!=="boolean")return 0;`, "x"},
		{"property", "b:{value:boolean|number}", `if(typeof b.value!=="boolean")return 0;`, "b.value"},
		{"element", "b:{value:boolean|number}", `if(typeof b["value"]!=="boolean")return 0;`, `b["value"]`},
	} {
		for _, shape := range []struct{ key, arms, code string }{
			{"missing", "when true:1;", "only:EK4701"},
			{"complete", "when true:1;when false:0;", ""},
			{"default", "when true:1;default:0;", ""},
		} {
			source := "export function f(" + input.parameters + "){" + input.prefix + "return match(" + input.subject + "){" + shape.arms + "};}"
			rules = append(rules, dataRule{"match-flow-domain-" + input.key + "-" + shape.key, "004-match.md", quote, source, shape.code, "impl-hunt-data"})
		}
	}
	for _, input := range []struct{ key, source, code string }{
		{"tagged-intersection-missing", `export function f(x:{_tag:"A"}|{_tag:"B"}){if("extra" in x)return match(x){when {_tag:"A"}:1;};return 0;}`, "only:EK4701"},
		{"tagged-intersection-complete", `export function f(x:{_tag:"A"}|{_tag:"B"}){if("extra" in x)return match(x){when {_tag:"A"}:1;when {_tag:"B"}:0;};return 0;}`, ""},
		{"assignment-missing", "export function f(){let x:boolean|number=false;return match(x){when false and if(false):1;};}", "only:EK4701"},
		{"assignment-complete", "export function f(){let x:boolean|number=false;return match(x){when false:0;};}", ""},
		{"undefined-missing", "export function f(x:string|undefined){if(x!==undefined)return 0;return match(x){when undefined and if(false):1;};}", "only:EK4701"},
		{"undefined-complete", "export function f(x:string|undefined){if(x!==undefined)return 0;return match(x){when undefined:0;};}", ""},
		{"open", "export function f(x:boolean|number){return match(x){when true:1;};}", ""},
		{"widened", "export function f(x:boolean|number,n:number){if(typeof x!==\"boolean\")return 0;x=n;return match(x){when let v and if(false):1;};}", ""},
	} {
		rules = append(rules, dataRule{"match-flow-domain-" + input.key, "004-match.md", quote, input.source, input.code, "impl-hunt-data"})
	}
	return rules
}
