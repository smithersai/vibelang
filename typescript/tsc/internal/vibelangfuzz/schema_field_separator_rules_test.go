package vibelangfuzz

// VIP-15 / detail 241: mutate the schema body's own field boundary while
// retaining native TypeScript diagnostics in nested and alias types.
const schemaFieldSeparatorQuote = "two fields on one line with no separator, `{ a: string b: number }`; write `;` or a line break between them"

func schemaFieldSeparatorRules() []dataRule {
	return []dataRule{
		{"schema-separator-fields-exported", "006-data.md", schemaFieldSeparatorQuote, "export schema S { a:string b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-optional", "006-data.md", schemaFieldSeparatorQuote, "schema S { a?:string b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-readonly", "006-data.md", schemaFieldSeparatorQuote, "schema S { readonly a:string b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-nested", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:{ n:number } b:string }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-comment", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:string /* keep */ b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-quoted", "006-data.md", schemaFieldSeparatorQuote, "schema S { \"a\":string b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-union", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:\"x\" | \"y\" b:number }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-namespace", "006-data.md", schemaFieldSeparatorQuote, "namespace N { export schema S { a:string b:number } }", "only:EK1504", "impl-hunt-data"},
		{"schema-separator-fields-semicolon", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:string; b?:number }", "", "impl-hunt-data"},
		{"schema-separator-fields-comma-optional", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:string, b?:number }", "", "impl-hunt-data"},
		{"schema-separator-fields-newline", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:string\nb:number }", "", "impl-hunt-data"},
		{"schema-separator-fields-block-newline", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:string /*\n*/ b:number }", "", "impl-hunt-data"},
		{"schema-separator-native-nested-type", "006-data.md", schemaFieldSeparatorQuote, "schema S { a:{ n:number s:string }; b:string }", "only:TS1005", "impl-hunt-data"},
		{"schema-separator-native-alias-type", "006-data.md", schemaFieldSeparatorQuote, "schema S = { a:string b:number }", "only:TS1005", "impl-hunt-data"},
	}
}
