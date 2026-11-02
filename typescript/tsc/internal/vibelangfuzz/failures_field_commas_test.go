package vibelangfuzz

// Chapter 3 shares Field/Separator with data and schema. Appendix A explicitly
// admits comma after a complete field type; class-method punctuation is separate.
func failuresFieldCommaCases() []*failCase {
	const quote = `Separator = ";" | "," | a LineTerminator before the next token | before "}"`
	var cases []*failCase
	for _, form := range []struct {
		name, syntax string
		vip          int
	}{
		{"error", "error", 13}, {"schema-error", "schema error", 29},
	} {
		for _, c := range []struct{ name, body, args, read, typ string }{
			{"fields", "id: string, count: number", "id: \"x\", count: 1", "value.count", "number"},
			{"optional", "id?: string, count: number", "count: 1", "value.count", "number"},
			{"literal", "\"id\": string, 7: number", "id: \"x\", 7: 1", "value[7]", "number"},
			{"members", "id: string, get label(): string { return this.id } count: number", "id: \"x\", count: 1", "value.label", "string"},
			{"readonly", "readonly id: string, readonly count: number", "id: \"x\", count: 1", "value.count", "number"},
			{"comments", "id: string /* before */, /** @internal */ count: number,", "id: \"x\", count: 1", "value.count", "number"},
			{"multiline", "id:\n string |\n number,\ncount?: number", "id: \"x\"", "value.id", "string | number"},
			{"trailing", "id: string,", "id: \"x\"", "value.id", "string"},
		} {
			cases = append(cases, &failCase{
				Name: form.name + "-payload-comma-" + c.name, Chapter: "900-appendices.md", Quote: quote, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none",
				Decls: "export " + form.syntax + " Entry { " + c.body + " }\nconst value = new Entry({ " + c.args + " })\nexport const checked: " + c.typ + " = " + c.read + "\n",
			})
		}
	}
	return cases
}
