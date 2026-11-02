package vibelangfuzz

// Chapter 3 requires seeing through brands in template placeholders.
// Existing keyed FuzzFailuresSpec mutations cover placement and module hosts.
func failuresNominalKeyCases() []*failCase {
	const reservedQuote = "Raw assignability of the unbranded string literal to a nominal key type does not establish that exclusion."
	const safeQuote = "Safe literals, literal unions, templates and their brands remain admitted; `never` has no possible key."
	const prelude = "type Brand = string & { readonly brand: unique symbol }; type LiteralBrand = \"x\" & { readonly brand: unique symbol }; type UpperTag = \"_TAG\" & { readonly brand: unique symbol }; type Count = \"COUNT\" & { readonly brand: unique symbol }; "
	var cases []*failCase
	for _, row := range []struct {
		name, domain string
		reserved     bool
	}{
		{"brand", "Brand", true},
		{"literal-brand", "LiteralBrand", false},
		{"template-brand", "`${Brand}`", true},
		{"template-brand-suffix", "`${Brand}tag`", true},
		{"template-brand-prefix", "`_${Brand}`", true},
		{"template-brand-safe-prefix", "`x-${Brand}`", false},
		{"template-literal-brand", "`${LiteralBrand}`", false},
		{"lowercase-brand", "Lowercase<Brand>", true},
		{"uppercase-brand", "Uppercase<Brand>", false},
		{"capitalize-brand", "Capitalize<Brand>", true},
		{"uncapitalize-brand", "Uncapitalize<Brand>", true},
		{"multiple-holes", "`${Brand}${Brand}`", true},
		{"safe-multiple-holes", "`${Brand}x${Brand}`", false},
		{"literal-fragments", "`_${Brand}ag`", true},
		{"safe-suffix", "`_${Brand}x`", false},
		{"number-hole", "`${number}`", false},
		{"boolean-hole", "`${boolean}`", false},
		{"union-hole", "`${Brand | \"safe\"}`", true},
		{"lowercase-literal-brand", "Lowercase<UpperTag>", true},
		{"safe-lowercase-literal-brand", "Lowercase<Count>", false},
	} {
		code, quote := 0, safeQuote
		member := "get [key](): number { return 1 }"
		if row.reserved {
			code, quote = 2117, reservedQuote
			member = "⟦" + member + "⟧"
		}
		cases = append(cases, &failCase{Name: "schema-error-nominal-key-" + row.name, Quote: quote, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: prelude + "declare const key: " + row.domain + "; export schema error Bad { id: string; " + member + " }", Code: code, OneDiagnostic: row.reserved})
	}
	return cases
}
