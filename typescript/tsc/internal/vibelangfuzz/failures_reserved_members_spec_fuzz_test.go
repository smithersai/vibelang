package vibelangfuzz

import "fmt"

// Existing chapter-3 quote and keyed FuzzFailuresSpec machinery provide both
// the quote freshness gate and placement/module mutations for this neighborhood.
func failuresReservedMemberCases() []*failCase {
	const rule = "| a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `\"_tag\"`; use a literal key or a symbol | `EK2117` |"
	members := []string{
		"static _tag = 1",
		"static _tag() { return 1 }",
		"static get _tag() { return 1 }",
		"static set _tag(value: number) {}",
		"get _tag(): \"Bad\" { return \"Bad\" }",
		"set _tag(value: string) {}",
		"static [\"_tag\"] = 1",
		"private _tag: \"Bad\"",
		"protected _tag: \"Bad\"",
		"public _tag: string",
		"_tag!: \"Bad\"",
	}
	var cases []*failCase
	for _, form := range []struct {
		name, syntax string
		vip          int
	}{{"error", "error", 13}, {"schema-error", "schema error", 29}} {
		for i, member := range members {
			cases = append(cases, &failCase{
				Name:  fmt.Sprintf("%s-reserved-member-%d", form.name, i),
				Quote: rule, Owner: "impl-hunt-fail", VIP: form.vip,
				Host: "none", Decls: "export " + form.syntax + " Bad { ⟦" + member + "⟧ }",
				Code: 2117, OneDiagnostic: true,
			})
		}
	}
	for _, form := range []struct {
		name, syntax string
		vip          int
	}{{"error", "error", 13}, {"schema-error", "schema error", 29}} {
		for _, sample := range []struct{ name, member string }{
			{"literal", "[\"_tag\"] = 1"},
			{"typed", "[\"_tag\"]: number = 1"},
			{"escaped", "[\"\\u005ftag\"] = 1"},
		} {
			cases = append(cases, &failCase{
				Name:  fmt.Sprintf("%s-reserved-initialized-%s", form.name, sample.name),
				Quote: rule, Owner: "impl-hunt-fail", VIP: form.vip,
				Host: "none", Decls: "export " + form.syntax + " Bad { ⟦" + sample.member + "⟧ }",
				Code: 2117, OneDiagnostic: true,
			})
		}
	}
	return cases
}
