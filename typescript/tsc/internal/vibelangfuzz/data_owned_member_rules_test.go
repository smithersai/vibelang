package vibelangfuzz

func dataOwnedMemberRules() []dataRule {
	return []dataRule{
		{"owned-member-schema-method", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { m():string }", "only:EK1505"},
		{"owned-member-schema-index", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { [key:string]:number }", "only:EK1505"},
		{"owned-member-schema-call", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { (n:number):string }", "only:EK1505"},
		{"owned-member-schema-construct", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { new (n:number):object }", "only:EK1505"},
		{"owned-member-schema-getter", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { get n():number }", "only:EK1505"},
		{"owned-member-schema-setter", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { set n(v:number) }", "only:EK1505"},
		{"owned-member-schema-untyped", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { n }", "only:EK1505"},
		{"owned-member-schema-nested", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { inner:{ m():void } }", "only:EK1505"},
		{"owned-member-schema-readonly-nested", "006-data.md", "a member of a `schema` body that is not a [Field](900-appendices.md#field)", "schema S { readonly inner:{ m():void } }", "only:EK1505"},
		{"owned-member-data-method", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { m():void } }", "only:EK1606"},
		{"owned-member-data-index", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { [key:string]:unknown } }", "only:EK1606"},
		{"owned-member-data-call", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { (n:number):string } }", "only:EK1606"},
		{"owned-member-data-untyped", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A { n } }", "only:EK1606"},
		{"owned-member-data-parenthesized", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(n:number) }", "only:EK1606"},
		{"owned-member-data-parenthesized-function", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(f:(n:number)=>void) }", "only:EK1606"},
		{"owned-member-data-generic-parenthesized", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D<T> { A(n:T) }", "only:EK1606"},
		{"owned-member-data-parenthesized-recovery", "006-data.md", "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)", "data D { A(n:number); B }; const b:D=D.B()", "only:EK1606"},
		{"owned-member-schema-fields", "006-data.md", "properties are writable unless `readonly`", "schema S { n:number; readonly name?:string }", ""},
		{"owned-member-data-fields", "006-data.md", "a variant's fields may be `readonly`", "data D { A { n:number; readonly name?:string }; B }; const d:D=D.A({n:1})", ""},
	}
}
