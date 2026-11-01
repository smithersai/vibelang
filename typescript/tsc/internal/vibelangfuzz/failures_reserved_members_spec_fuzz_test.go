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
	// VIP-29: a schema error's computed method, accessor or static key must
	// be proved to exclude "_tag"; a getter under it would shadow the tag.
	for i, key := range []struct{ decl, member string }{
		{"declare const key: string", "get [key](): number { return 1 }"},
		{"declare const key: \"id\" | \"_tag\"", "[key]() { return 1 }"},
		{"declare const key: string & { readonly brand: unique symbol }", "get [key](): number { return 1 }"},
		{"declare const key: `${string}`", "[key]() { return 1 }"},
		{"declare const key: any", "static [key] = 1"},
	} {
		cases = append(cases, &failCase{
			Name:  fmt.Sprintf("schema-error-member-key-domain-%d", i),
			Quote: rule, Owner: "impl-hunt-fail", VIP: 29,
			Host: "none", Decls: key.decl + "\nexport schema error Bad { id: string; ⟦" + key.member + "⟧ }",
			Code: 2117, OneDiagnostic: true,
		})
	}
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-0", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-1", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-2", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag?: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-3", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦readonly _tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-4", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦\"_tag\": string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-5", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦'\\u005ftag': string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-6", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: number⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-7", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: unknown⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-8", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: never⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-9", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: any⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-10", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag /* key */: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-11", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: /* type */ string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-12", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦\\u005ftag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-concrete-13", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-0", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-1", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-2", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag?: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-3", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦readonly _tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-4", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦\"_tag\": string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-5", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦'\\u005ftag': string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-6", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: number⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-7", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: unknown⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-8", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: never⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-9", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: any⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-10", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag /* key */: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-11", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: /* type */ string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-12", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦\\u005ftag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "error-reserved-payload-abstract-13", Quote: rule, Owner: "impl-hunt-fail", VIP: 13, Host: "none", Decls: "export abstract error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-0", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-1", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-2", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag?: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-3", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦readonly _tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-4", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦\"_tag\": string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-5", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦'\\u005ftag': string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-6", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: number⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-7", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: unknown⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-8", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: never⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-9", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: any⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-10", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag /* key */: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-11", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: /* type */ string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-12", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦\\u005ftag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-concrete-13", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export schema error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-0", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-1", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-2", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag?: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-3", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦readonly _tag: \"Bad\"⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-4", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦\"_tag\": string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-5", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦'\\u005ftag': string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-6", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: number⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-7", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: unknown⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-8", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: never⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-9", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: any⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-10", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag /* key */: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-11", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: /* type */ string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-12", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦\\u005ftag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	cases = append(cases, &failCase{Name: "schema-error-reserved-payload-abstract-13", Quote: rule, Owner: "impl-hunt-fail", VIP: 29, Host: "none", Decls: "export abstract schema error Bad { ⟦_tag: string⟧; id: string }", Code: 2117, OneDiagnostic: true})
	return cases
}
