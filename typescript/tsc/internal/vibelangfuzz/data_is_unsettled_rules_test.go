package vibelangfuzz

// VIP-7, details214/240/249: diagnostics only; no second Exit comparator.
func unsettledIsBindingRules() []dataRule {
	return []dataRule{
		// Detail249 applies this conservative parameter-home rule to native catch initialization.
		{"is-unsettled-catch-default", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({code=(1 is let c)}){}}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-catch-nested", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({inner:{code=(1 is const c)}={}}){}}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-catch-computed", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({[(1 is let c)?\"x\":\"y\"]:code}){}}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-catch-skipped", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({code=false && (1 is let c)}){}}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-catch-control-free", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({code=(1 is Number)}){}}", "", "impl-hunt-data"},
		{"is-unsettled-catch-control-callable", "004-match.md", "The pinned explainer leaves that scope unfinished, so no parameter-home binding is invented or moved into the body.", "function f(){try{(null as any).code}catch({code=()=>{if(1 is let c)return c;return 0}}){}}", "", "impl-hunt-data"},

		{"is-unsettled-direct", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f(a=(1 is let one)){return a}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-destructuring", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f({a=(1 is const one)}={}){return a}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-computed", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f({[(1 is let one)?\"x\":\"y\"]:value}:{x?:number;y?:number}={}){}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-nested-parameter", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function outer(){function f(a=(1 is let one)){return a}}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-skipped", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f(a=false && (1 is let one)){return a}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-enum", "004-match.md", "An `enum` member initializer has no lexical home in ECMAScript or the pinned explainer", "enum E{A=(1 is let one)?1:0}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-enum-skipped", "004-match.md", "An `enum` member initializer has no lexical home in ECMAScript or the pinned explainer", "enum E{A=(false && (1 is let one))?1:0}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-match-subject", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f(a=match(1 is let one){default:0;}){return a}", "EK0705", "impl-hunt-data"},
		{"is-unsettled-control-binding-free", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f(a=(1 is Number)){return a}", "", "impl-hunt-data"},
		{"is-unsettled-control-enum-binding-free", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "enum E{A=(1 is Number)?1:0}", "", "impl-hunt-data"},
		{"is-unsettled-control-callable-block", "004-match.md", "An `is` test in formal-parameter initialization is `EK0705` if a `let` or `const` pattern binding would need the parameter environment as its lexical home.", "function f(a=(():number=>{if(1 is let one)return one;return 0})()){return a}", "", "impl-hunt-data"},
	}
}
