package vibelangfuzz

func dataVariantMemberAdmissionRules() []dataRule {
	return []dataRule{
		{"variant-member-unclosed-recovery", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(x:number } data E { B }; const b:E=E.B()", "only:EK1606"},
		{"variant-member-parenthesized", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(x:number) }", "only:EK1606"},
		{"variant-member-function-parameter", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(f:(n:number)=>void) }", "only:EK1606"},
		{"variant-member-generic", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D<T> { A(x:T) }", "only:EK1606"},
		{"variant-member-recovery", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(x:number); B }; const b:D=D.B()", "only:EK1606"},
		{"variant-member-newline-recovery", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(x:number)\nB }; const b:D=D.B()", "only:EK1606"},
		{"variant-member-object-parameter", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(x:{n:number}); B }; const b:D=D.B()", "only:EK1606"},
		{"variant-member-method", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { m():void } }", "only:EK1606"},
		{"variant-member-generic-method", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D<T> { A { m(x:T):T } }", "only:EK1606"},
		{"variant-member-index", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { [key:string]:unknown } }", "only:EK1606"},
		{"variant-member-call", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { (n:number):string } }", "only:EK1606"},
		{"variant-member-construct", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { new(n:number):object } }", "only:EK1606"},
		{"variant-member-getter", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { get n():number } }", "only:EK1606"},
		{"variant-member-setter", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { set n(v:number) } }", "only:EK1606"},
		{"variant-member-untyped", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { n } }", "only:EK1606"},
		{"variant-member-fields", "006-data.md", "a variant's fields may be `readonly`", "data D { A { n:number; readonly name?:string }; B }; const d:D=D.A({n:1})", ""},
		{"variant-member-newline-body", "006-data.md", "a variant's fields may be `readonly`", "data D { A\n{ n:number }; B }; const d:D=D.A({n:1})", ""},
		{"variant-member-function-field", "006-data.md", "a variant's fields may be `readonly`", "data D { A { f:(n:number)=>void } }", ""},
		{"variant-member-nested-method", "006-data.md", "a variant's fields may be `readonly`", "data D { A { inner:{ m():void } } }", ""},
	}
}
