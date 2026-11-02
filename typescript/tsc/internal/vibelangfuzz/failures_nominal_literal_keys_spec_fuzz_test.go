package vibelangfuzz

// Chapter 3 reserves a known tag name even when its singleton type has a brand.
// Placement and module-host mutations come from the keyed failures generator.
func failuresNominalLiteralKeyCases() []*failCase {
	const prelude = "type KeyBrand = { readonly brand: unique symbol }; type Tag = \"_tag\" & KeyBrand; type Word = \"tag\" & KeyBrand; type Underscore = \"_\" & KeyBrand; type Upper = \"_TAG\" & KeyBrand; declare const unique: unique symbol; "
	var cases []*failCase
	for _, row := range []struct {
		name, domain string
		reserved     bool
	}{
		{"raw-tag", "\"_tag\"", true},
		{"tag-brand", "Tag", true},
		{"nested-brand", "Tag & { readonly extra: unique symbol }", true},
		{"string-intersection", "Tag & string", true},
		{"unknown-intersection", "Tag & unknown", true},
		{"same-union", "Tag | \"_tag\"", true},
		{"template-brand", "`${Tag}`", true},
		{"template-prefix", "`_${Word}`", true},
		{"template-suffix", "`${Underscore}tag`", true},
		{"lowercase-brand", "Lowercase<Upper>", true},
		{"capitalize-brand", "Capitalize<Tag>", true},
		{"uncapitalize-brand", "Uncapitalize<Tag>", true},
		{"nested-mapping", "Lowercase<Uppercase<Tag>>", true},
		{"safe-brand", "\"safe\" & KeyBrand", false},
		{"union-brand", "(\"_tag\" | \"safe\") & KeyBrand", false},
		{"string-brand", "string & KeyBrand", false},
		{"string", "string", false},
		{"lowercase-broad", "Lowercase<string & KeyBrand>", false},
		{"uppercase-tag", "Uppercase<Tag>", false},
		{"lowercase-safe", "Lowercase<\"SAFE\" & KeyBrand>", false},
		{"template-double", "`${Tag}${Tag}`", false},
		{"template-safe-prefix", "`x-${Tag}`", false},
		{"number", "number", false},
		{"symbol", "typeof unique", false},
		{"never", "never", false},
	} {
		code, quote := 0, "Actual methods and getters keep TypeScript's computed-name evaluation."
		member := "get [key](): number { return 1 }"
		if row.reserved {
			code = 2117
			quote = "a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `\"_tag\"`; use a literal key or a symbol"
			member = "⟦" + member + "⟧"
		}
		cases = append(cases, &failCase{Name: "error-nominal-literal-key-" + row.name, Quote: quote, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: prelude + "declare const key: " + row.domain + "; export error Bad { id: string; " + member + " }", Code: code, OneDiagnostic: row.reserved})
	}
	return cases
}
