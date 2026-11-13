package vibelangfuzz

// VIP-16 / detail 241: mutate the declaration-owned member boundary while
// retaining native TypeScript diagnostics in nested and ordinary types.
func dataMemberSeparatorRules() []dataRule {
	const quote = "A missing separator between two variants or two fields of a variant, `data D { A B }` or `A { x: number y: string }`, is `EK1605`."
	return []dataRule{
		{"data-separator-variants-bare", "006-data.md", quote, "data D { A B }", "only:EK1605"},
		{"data-separator-variants-payload", "006-data.md", quote, "data D { A { x:number } B }", "only:EK1605"},
		{"data-separator-variants-empty", "006-data.md", quote, "data D { A {} B {} }", "only:EK1605"},
		{"data-separator-variants-reserved", "006-data.md", quote, "data D { default return }", "only:EK1605"},
		{"data-separator-variants-comment", "006-data.md", quote, "data D { A /* keep */ B }", "only:EK1605"},
		{"data-separator-fields-optional", "006-data.md", quote, "data D { A { x?:number y:string } }", "only:EK1605"},
		{"data-separator-fields-readonly", "006-data.md", quote, "data D { A { readonly x:number y:string } }", "only:EK1605"},
		{"data-separator-fields-nested", "006-data.md", quote, "data D { A { x:{ n:number } y:string } }", "only:EK1605"},
		{"data-separator-fields-comment", "006-data.md", quote, "data D { A { x:number /* keep */ y:string } }", "only:EK1605"},
		{"data-separator-fields-computed", "006-data.md", quote, "declare const key:unique symbol; data D { A { [key]:number y:string } }", "only:EK1605"},
		{"data-separator-variants-semicolon", "006-data.md", quote, "data D { A; B }", ""},
		{"data-separator-variants-newline", "006-data.md", quote, "data D { A\nB }", ""},
		{"data-separator-variants-block-newline", "006-data.md", quote, "data D { A /*\n*/ B }", ""},
		{"data-separator-payload-newline-before-body", "006-data.md", quote, "data D { A\n{ x:number\ny:string }\nB }", ""},
		{"data-separator-fields-semicolon", "006-data.md", quote, "data D { A { x:number; y?:string } }", ""},
		{"data-separator-fields-block-newline", "006-data.md", quote, "data D { A { x:number /*\n*/ y:string } }", ""},
		{"data-separator-variants-comma", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "data D { A, B }", ""},
		{"data-separator-variants-comma-trailing", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "data D { A { x:number }, B, }", ""},
		{"data-separator-variants-comma-line", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "data D { A,\nB { y:string } }", ""},
		{"data-separator-fields-comma", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "data D { A { x:number, y?:string, } }", ""},
		{"schema-separator-fields-comma", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "schema S { a:string, readonly b:number }", ""},
		{"schema-separator-fields-comma-trailing", "900-appendices.md", "Separator = \";\" | \",\" | a LineTerminator before the next token | before \"}\"", "schema S { a:string, }", ""},
		{"data-separator-native-nested-type", "006-data.md", quote, "data D { A { x:{ n:number s:string }; y:string } }", "only:TS1005"},
		{"data-separator-native-ordinary-type", "006-data.md", quote, "type D = { n:number s:string }", "only:TS1005"},
	}
}
