package vibelangfuzz

func dataComputedTagRules() []dataRule {
	return []dataRule{
		{"computed-tag-literal-double", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"_tag\"]:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-literal-single", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly ['_tag']:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-literal-escaped", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"\\u005ftag\"]:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-entity", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\";export data D { A { readonly [key]:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-entity-const", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\" as const;export data D { A { readonly [key]:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-qualified", "006-data.md", "a variant field named `_tag`", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-literal-double-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"_tag\"]?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-literal-single-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly ['_tag']?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-literal-escaped-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"\\u005ftag\"]?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-entity-optional", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\";export data D { A { readonly [key]?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-entity-const-optional", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\" as const;export data D { A { readonly [key]?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-qualified-optional", "006-data.md", "a variant field named `_tag`", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]?:string } }", "only:EK1601", "impl-hunt-data"},
		{"computed-tag-enum-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "enum Key { Tag=\"_tag\" };export data D { A { readonly [Key.Tag]:string } }", "", "impl-hunt-data"},
		{"computed-tag-broad-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "declare const key:string;export data D { A { readonly [key]:string } }", "only:TS2344", "impl-hunt-data"},
		{"computed-tag-symbol-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "declare const key:unique symbol;export data D { A { readonly [key]:string } }", "", "impl-hunt-data"},
		{"computed-tag-ordinary-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const key=\"field\";export data D { A { readonly [key]:string } }", "", "impl-hunt-data"},
		{"computed-tag-invalid-parenthesized", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const key=\"_tag\";export data D { A { readonly [(key)]:string } }", "only:TS1170", "impl-hunt-data"},
		{"computed-tag-invalid-element", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names[\"tag\"]]:string } }", "only:TS1170", "impl-hunt-data"},
		{"computed-tag-invalid-call", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "function key():\"_tag\"{return \"_tag\"}export data D { A { readonly [key()]:string } }", "only:TS1170", "impl-hunt-data"},
	}
}
