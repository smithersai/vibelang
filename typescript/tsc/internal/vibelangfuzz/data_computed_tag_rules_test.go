package vibelangfuzz

func dataComputedTagRules() []dataRule {
	return []dataRule{
		{"computed-tag-literal-double", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"_tag\"]:string } }", "only:EK1601"},
		{"computed-tag-literal-single", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly ['_tag']:string } }", "only:EK1601"},
		{"computed-tag-literal-escaped", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"\\u005ftag\"]:string } }", "only:EK1601"},
		{"computed-tag-entity", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\";export data D { A { readonly [key]:string } }", "only:EK1601"},
		{"computed-tag-entity-const", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\" as const;export data D { A { readonly [key]:string } }", "only:EK1601"},
		{"computed-tag-qualified", "006-data.md", "a variant field named `_tag`", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]:string } }", "only:EK1601"},
		{"computed-tag-literal-double-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"_tag\"]?:string } }", "only:EK1601"},
		{"computed-tag-literal-single-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly ['_tag']?:string } }", "only:EK1601"},
		{"computed-tag-literal-escaped-optional", "006-data.md", "a variant field named `_tag`", "export data D { A { readonly [\"\\u005ftag\"]?:string } }", "only:EK1601"},
		{"computed-tag-entity-optional", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\";export data D { A { readonly [key]?:string } }", "only:EK1601"},
		{"computed-tag-entity-const-optional", "006-data.md", "a variant field named `_tag`", "const key=\"_tag\" as const;export data D { A { readonly [key]?:string } }", "only:EK1601"},
		{"computed-tag-qualified-optional", "006-data.md", "a variant field named `_tag`", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names.tag]?:string } }", "only:EK1601"},
		{"computed-tag-enum", "006-data.md", "a variant field named `_tag`", "enum Key { Tag=\"_tag\" };export data D { A { readonly [Key.Tag]:string } }", "only:EK1601"},
		{"computed-tag-const-enum", "006-data.md", "a variant field named `_tag`", "const enum Key { Tag=\"_tag\" };export data D { A { readonly [Key.Tag]:string } }", "only:EK1601"},
		{"computed-tag-enum-other-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "enum Key { Tag=\"_tag\", Other=\"other\" };export data D { A { readonly [Key.Other]:string } }", ""},
		{"computed-tag-broad-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "declare const key:string;export data D { A { readonly [key]:string } }", "only:TS2344"},
		{"computed-tag-symbol-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "declare const key:unique symbol;export data D { A { readonly [key]:string } }", ""},
		{"computed-tag-ordinary-control", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const key=\"field\";export data D { A { readonly [key]:string } }", ""},
		{"computed-tag-invalid-parenthesized", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const key=\"_tag\";export data D { A { readonly [(key)]:string } }", "only:TS1170"},
		{"computed-tag-invalid-element", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "const names={tag:\"_tag\"} as const;export data D { A { readonly [names[\"tag\"]]:string } }", "only:TS1170"},
		{"computed-tag-invalid-call", "006-data.md", "Variant field keys follow TypeScript's type-member checks.", "function key():\"_tag\"{return \"_tag\"}export data D { A { readonly [key()]:string } }", "only:TS1170"},
	}
}
