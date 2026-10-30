package vibelangfuzz

// VIP-7 decided details 10, 78 and 102, quoted from the current chapter.
// Every source isolates finite-subject classification or arm coverage.
func dataExhaustivenessRules() []dataRule {
	return []dataRule{
		// Open number turns finite check off
		{name: "exhaustive-open-number", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "function f(x:number){return match(x){when 1:1;}}", code: "", owner: "vip-match"},
		// Open string turns finite check off
		{name: "exhaustive-open-string", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "function f(x:string){return match(x){when \"a\":1;}}", code: "", owner: "vip-match"},
		// Unknown turns finite check off
		{name: "exhaustive-open-unknown", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "function f(x:unknown){return match(x){when 1:1;}}", code: "", owner: "vip-match"},
		// Any turns finite check off
		{name: "exhaustive-open-any", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "function f(x:any){return match(x){when 1:1;}}", code: "", owner: "vip-match"},
		// Object turns finite check off
		{name: "exhaustive-open-object", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "function f(x:object){return match(x){when {x}:1;}}", code: "", owner: "vip-match"},
		// Ordinary class turns finite check off
		{name: "exhaustive-open-class", chapter: "004-match.md", quote: "Any other member (`string`, `number`, an untagged object or class instance, `unknown`, `any`) turns the check off", source: "class C{};function f(x:C){return match(x){when C:1;}}", code: "", owner: "vip-match"},
		// Option expands to Some and None
		{name: "exhaustive-finite-option-missing", chapter: "004-match.md", quote: "`Option.Option<A>` to `None | Some`", source: "function f(x:Option.Option<number>){return match(x){when Option.None:0;}}", code: "EK4701", owner: "vip-match"},
		// Each fixed Option pattern covers its case
		{name: "exhaustive-finite-option-complete", chapter: "004-match.md", quote: "`Option.Option<A>` to `None | Some`", source: "function f(x:Option.Option<number>){return match(x){when Option.Some(let v):v;when Option.None:0;}}", code: "", owner: "vip-match"},
		// Exit expands to Success and Failure
		{name: "exhaustive-finite-exit-missing", chapter: "004-match.md", quote: "`Exit.Exit<A, E>` and `Result.Result<A, E>` to `Success | Failure`", source: "function f(x:Exit.Exit<number,string>){return match(x){when Exit.Success(let v):v;}}", code: "EK4701", owner: "vip-match"},
		// Each fixed Exit pattern covers its case
		{name: "exhaustive-finite-exit-complete", chapter: "004-match.md", quote: "`Exit.Exit<A, E>` and `Result.Result<A, E>` to `Success | Failure`", source: "function f(x:Exit.Exit<number,string>){return match(x){when Exit.Success(let v):v;when Exit.Failure(let c):c;}}", code: "", owner: "vip-match"},
		// Result expands to Success and Failure
		{name: "exhaustive-finite-result-missing", chapter: "004-match.md", quote: "`Exit.Exit<A, E>` and `Result.Result<A, E>` to `Success | Failure`", source: "function f(x:Result.Result<number,string>){return match(x){when Result.Success(let v):v;}}", code: "EK4701", owner: "vip-match"},
		// Each fixed Result pattern covers its case
		{name: "exhaustive-finite-result-complete", chapter: "004-match.md", quote: "`Exit.Exit<A, E>` and `Result.Result<A, E>` to `Success | Failure`", source: "function f(x:Result.Result<number,string>){return match(x){when Result.Success(let v):v;when Result.Failure(let e):e;}}", code: "", owner: "vip-match"},
		// Bare binding covers every finite member
		{name: "exhaustive-binding-covers", chapter: "004-match.md", quote: "covers every member.", source: "function f(x:boolean){return match(x){when let v:v;}}", code: "", owner: "vip-match"},
		// Or covers union of alternatives
		{name: "exhaustive-or-covers", chapter: "004-match.md", quote: "`or` covers the union of its alternatives.", source: "function f(x:boolean){return match(x){when true or false:1;}}", code: "", owner: "vip-match"},
		// And covers nothing statically
		{name: "exhaustive-and-does-not-cover", chapter: "004-match.md", quote: "`and`, `not`, regex, relational, array, built-in matcher and user-matcher patterns cover nothing", source: "function f(x:boolean){return match(x){when true and true:1;when false:0;}}", code: "EK4701", owner: "vip-match"},
		// Not covers nothing statically
		{name: "exhaustive-not-does-not-cover", chapter: "004-match.md", quote: "`and`, `not`, regex, relational, array, built-in matcher and user-matcher patterns cover nothing", source: "function f(x:boolean){return match(x){when not false:1;when false:0;}}", code: "EK4701", owner: "vip-match"},
		// Bare required field covers entire variant
		{name: "exhaustive-required-key-covers", chapter: "004-match.md", quote: "`\"x\" in s` removes a member from its false branch only where `x` is required.", source: "data D{V{n:number}};function f(x:D){return match(x){when {_tag:\"V\",n}:1;}}", code: "", owner: "vip-match"},
		// Required field binding covers entire variant
		{name: "exhaustive-required-binding-covers", chapter: "004-match.md", quote: "`\"x\" in s` removes a member from its false branch only where `x` is required.", source: "data D{V{n:number}};function f(x:D){return match(x){when {_tag:\"V\",let n}:n;}}", code: "", owner: "vip-match"},
		// Optional field may be absent
		{name: "exhaustive-optional-key-does-not-cover", chapter: "004-match.md", quote: "`\"x\" in s` removes a member from its false branch only where `x` is required.", source: "data D{V{n?:number}};function f(x:D){return match(x){when {_tag:\"V\",n}:1;}}", code: "EK4701", owner: "vip-match"},
		// Value-constrained field leaves other values
		{name: "exhaustive-constrained-key-does-not-cover", chapter: "004-match.md", quote: "`\"x\" in s` removes a member from its false branch only where `x` is required.", source: "data D{V{n:number}};function f(x:D){return match(x){when {_tag:\"V\",n:1}:1;}}", code: "EK4701", owner: "vip-match"},
		// Or combines complete data variants
		{name: "exhaustive-or-variants-cover", chapter: "004-match.md", quote: "`or` covers the union of its alternatives.", source: "data D{A;B};function f(x:D){return match(x){when {_tag:\"A\"} or {_tag:\"B\"}:1;}}", code: "", owner: "vip-match"},
		// Schema error union is finite
		{name: "exhaustive-schema-errors-missing", chapter: "004-match.md", quote: "literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance", source: "schema error A;schema error B;function f(x:A|B){return match(x){when A:1;}}", code: "EK4701", owner: "vip-match"},
		// Mixed permitted finite members still checked
		{name: "exhaustive-error-undefined-missing", chapter: "004-match.md", quote: "literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance", source: "error E;function f(x:E|undefined){return match(x){when E:1;}}", code: "EK4701", owner: "vip-match"},
		// Undefined literal covers its member
		{name: "exhaustive-error-undefined-complete", chapter: "004-match.md", quote: "literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance", source: "error E;function f(x:E|undefined){return match(x){when E:1;when undefined:0;}}", code: "", owner: "vip-match"},
		// Null literal covers its member
		{name: "exhaustive-error-null-complete", chapter: "004-match.md", quote: "literal type, `true`, `false`, `null`, `undefined`, an enum member, a `data` variant, an `error` or `schema error` instance", source: "error E;function f(x:E|null){return match(x){when E:1;when null:0;}}", code: "", owner: "vip-match"},
		// Retained Effect errors remain finite alongside declared errors
		{name: "exhaustive-retained-error-missing", chapter: "004-match.md", quote: "a retained error's bare or one-binding extractor cover their case", source: "error E;function f(x:E|Cause.TimeoutError){return match(x){when E:1;}}", code: "EK4701", owner: "vip-match"},
		// Bare binding extractor covers retained error
		{name: "exhaustive-retained-error-complete", chapter: "004-match.md", quote: "a retained error's bare or one-binding extractor cover their case", source: "error E;function f(x:E|Cause.TimeoutError){return match(x){when E:1;when Cause.TimeoutError(let e):0;}}", code: "", owner: "vip-match"},
	}
}
