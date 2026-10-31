package vibelangfuzz

// VIP-16 / detail 241: mutate the declaration-owned member boundary while
// retaining native TypeScript diagnostics in nested and ordinary types.
func dataMemberSeparatorRules() []dataRule {
	const quote = "A missing separator between two variants or two fields of a variant, `data D { A B }` or `A { x: number y: string }`, is `EK1605`."
	return []dataRule{
		{"data-separator-variants-bare", "006-data.md", quote, "data D { A B }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-variants-payload", "006-data.md", quote, "data D { A { x:number } B }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-variants-empty", "006-data.md", quote, "data D { A {} B {} }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-variants-reserved", "006-data.md", quote, "data D { default return }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-variants-comment", "006-data.md", quote, "data D { A /* keep */ B }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-fields-optional", "006-data.md", quote, "data D { A { x?:number y:string } }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-fields-readonly", "006-data.md", quote, "data D { A { readonly x:number y:string } }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-fields-nested", "006-data.md", quote, "data D { A { x:{ n:number } y:string } }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-fields-comment", "006-data.md", quote, "data D { A { x:number /* keep */ y:string } }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-fields-computed", "006-data.md", quote, "declare const key:unique symbol; data D { A { [key]:number y:string } }", "only:EK1605", "impl-hunt-data"},
		{"data-separator-variants-semicolon", "006-data.md", quote, "data D { A; B }", "", "impl-hunt-data"},
		{"data-separator-variants-newline", "006-data.md", quote, "data D { A\nB }", "", "impl-hunt-data"},
		{"data-separator-variants-block-newline", "006-data.md", quote, "data D { A /*\n*/ B }", "", "impl-hunt-data"},
		{"data-separator-payload-newline-before-body", "006-data.md", quote, "data D { A\n{ x:number\ny:string }\nB }", "", "impl-hunt-data"},
		{"data-separator-fields-semicolon", "006-data.md", quote, "data D { A { x:number; y?:string } }", "", "impl-hunt-data"},
		{"data-separator-fields-block-newline", "006-data.md", quote, "data D { A { x:number /*\n*/ y:string } }", "", "impl-hunt-data"},
		{"data-separator-native-nested-type", "006-data.md", quote, "data D { A { x:{ n:number s:string }; y:string } }", "only:TS1005", "impl-hunt-data"},
		{"data-separator-native-ordinary-type", "006-data.md", quote, "type D = { n:number s:string }", "only:TS1005", "impl-hunt-data"},
	}
}
