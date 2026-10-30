package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Static rules only. Runtime meanings belong to FuzzVIPDifferential.
// Each quote is checked against the current chapter before compiling a witness.
type dataRule struct {
	name, chapter, quote, source, code, owner string
}

func dataRules() []dataRule {
	const match = "004-match.md"
	const data = "006-data.md"
	const errors = "003-failures.md"
	var rules []dataRule
	add := func(name, chapter, quote, source, code, owner string) {
		rules = append(rules, dataRule{name, chapter, quote, source, code, owner})
	}
	for _, c := range []struct{ name, source string }{
		{"final-semicolon", `function f() { return match(1) { default: 0 } }`},
		{"newline-separator", "function f() { return match(1) { when 1: 1\ndefault: 0; } }"},
		{"default-last", `function f() { return match(1) { default: 0; when 1: 1; } }`},
	} {
		quote := "Separate arms with `;`, including the final arm"
		code := "EK0701"
		if c.name == "newline-separator" {
			quote = "A newline alone is not a separator."
		}
		if c.name == "default-last" {
			quote = "`default` appears at most once, last"
			code = "error"
		}
		add(c.name, match, quote, c.source, code, "vip-match")
	}
	for _, c := range []struct{ name, decl, typ, arms string }{
		{"literal", "", `"a" | "b"`, `when "a": 1;`},
		{"boolean", "", "boolean", "when true: 1;"},
		{"data", "data D { A; B }", "D", `when { _tag: "A" }: 1;`},
		{"error", "error A; error B", "A | B", "when A: 1;"},
		{"enum", "enum E { A, B }", "E", "when E.A: 1;"},
	} {
		add("exhaustive-"+c.name, match, "into a union of members", c.decl+"\nfunction f(x: "+c.typ+") { return match(x) { "+c.arms+" } }", "EK4701", "vip-match")
	}
	add("guard-not-cover", match, "Only an unguarded arm covers anything.", `function f(x:boolean) { return match(x) { when true and if (true): 1; when false: 0; } }`, "EK4701", "vip-match")
	// Decided detail 25: data Empty {} with zero variants is allowed:
	// an exact empty Data.TaggedEnum (delete EK2122).
	add("empty-data", data, "Zero variants are allowed", `data Empty {}; const empty: Empty = null as never`, "", "vip-core2")
	for n := 1; n <= 4; n++ {
		params := []string{"First", "Second", "Third", "Fourth"}[:n]
		var fields, args []string
		for i, p := range params {
			fields = append(fields, fmt.Sprintf("f%d:%s", i, p))
			args = append(args, "number")
		}
		add(fmt.Sprintf("generic-%d-hygiene", n), data, "so it never collides with a user name and is the same on every build", `type GDefinition = string; const prior:GDefinition="user"; data G<`+strings.Join(params, ",")+`> { V { `+strings.Join(fields, ";")+` } }; const g:G<`+strings.Join(args, ",")+`> = null as never`, "", "vip-core2")
	}
	add("generic-limit", data, "more than 4 type parameters; remove parameters beyond the limit of 4", `data G<A,B,C,D,E> { V { a:A;b:B;c:C;d:D;e:E } }`, "EK2801", "vip-core2")
	// Decided detail 27: Constraints on generic data type parameters
	// (<A extends string>) are a compile error, since VIP-28 does not add
	// them (EK2126 keeps that part). Chapter 6 shows plain parameters only.
	add("generic-constraint", data, "Constraints such as `<A extends string>` and defaults such as `<A = string>` are compile errors", `data G<A extends string> { V { value:A } }`, "EK2126", "vip-core2")

	for _, c := range []struct{ name, field, mutation, code string }{
		{"field", "readonly x:number", "s.x=2", "TS2540"},
		{"array", "x:readonly number[]", "s.x.push(2)", "TS2339"},
		{"tuple", "x:readonly [number,number]", "s.x[0]=2", "TS2540"},
		{"record", "x:Readonly<Record<string,number>>", "s.x.a=2", "TS2542"},
		{"nested", "x:{readonly n:number}", "s.x.n=2", "TS2540"},
	} {
		add("schema-readonly-"+c.name, data, "Mappings preserve TypeScript mutability", `schema S { `+c.field+` }; function f(s:S) { `+c.mutation+` }`, c.code, "vip-decls")
	}
	add("schema-writable", data, "properties are writable unless `readonly`; arrays and tuples are mutable unless `readonly`.", `schema S { n:number; xs:number[]; pair:[number,number]; counts:Record<string,number> }; function f(s:S) { s.n=2; s.xs.push(2); s.pair[0]=3; s.counts.a=4 }`, "", "vip-decls")
	add("schema-shallow-readonly", data, "`Schema.mutableKey` changes the property, not its nested value", `schema S { readonly xs:number[] }; function f(s:S) { s.xs.push(2) }`, "", "vip-decls")
	add("schema-shallow-mutable", data, "`Schema.mutable` changes an array or tuple, not its elements.", `schema S { xs:{readonly n:number}[] }; function f(s:S) { s.xs[0].n=2 }`, "TS2540", "vip-decls")
	add("schema-unmapped", data, "a field type outside the mapping", `schema S { x: () => void }`, "EK2109", "vip-decls")
	add("schema-error-bodyless", errors, "Omitting the body means no fields", `schema error Timeout; const e:Timeout=new Timeout()`, "", "vip-decls")
	add("schema-error-readonly", errors, "Every field is readonly", `schema error E { n:number }; function f(e:E) { e.n=2 }`, "TS2540", "vip-decls")
	for _, c := range []struct{ name, source, quote string }{
		{"constructor", `schema error E { constructor() {} }`, "a constructor in an `error` or `schema error` body"},
		{"tag", `schema error E { _tag:string }`, "a `_tag` member in an `error` or `schema error` body"},
		{"static", `schema error E { static x=1 }`, "User-written `static` members and setters are forbidden in both forms."},
		{"setter", `schema error E { set x(v:number) {} }`, "User-written `static` members and setters are forbidden in both forms."},
		{"generics", `schema error E<T> { n:T }`, "Neither form accepts type parameters."},
		{"extends", `schema error A; schema error B extends A {}`, "an `extends` clause"},
	} {
		code := map[string]string{"constructor": "EK1301", "tag": "EK2117", "static": "EK1302", "setter": "EK1302", "generics": "EK1303", "extends": "EK2117"}[c.name]
		add("schema-error-"+c.name, errors, c.quote, c.source, code, "vip-decls")
	}
	add("schema-error-method-getter", errors, "Fields, methods and getters may be interleaved", `schema error E { n:number; get doubled() { return this.n*2 }; m:number; value() { return this.m } }; function f(e:E):number { return e.doubled+e.value() }`, "", "vip-decls")
	add("data-required-field", data, "declares Effect's "+"`Data.TaggedEnum` type", `data D { V { n:number } }; const d=D.V({})`, "error", "vip-core2")
	add("schema-readonly-optional", data, "readonly optional field", `schema S { readonly x?:number }; function f(s:S) { s.x=2 }`, "TS2540", "vip-decls")
	add("schema-record-key", data, "Record keys must satisfy Effect’s `Schema.Record.Key` constraint.", `schema S { x:Record<boolean,number> }`, "error", "vip-decls")
	add("schema-contextual", data, "the keyword and the name on one line, where a declaration can start", `const schema=1; const data=2; export const sum=schema+data`, "", "vip-decls")
	add("schema-error-alias", errors, "differ at the next token.", `schema error = string; const s:error="ok"`, "", "vip-decls")
	for _, c := range []struct{ name, typ, value string }{
		{"string", "string", `"ok"`},
		{"number", "number", "7"},
		{"boolean", "boolean", "true"},
		{"bigint", "bigint", "7n"},
		{"literal-string", `"ok"`, `"ok"`},
		{"literal-number", "7", "7"},
		{"literal-boolean", "true", "true"},
		{"literal-bigint", "7n", "7n"},
		{"null", "null", "null"},
		{"undefined", "undefined", "undefined"},
		{"union", "string | null", "null"},
		{"array", "Array<number>", "[7]"},
		{"readonly-array", "ReadonlyArray<number>", "[7]"},
		{"tuple", "[string,number]", `["ok",7]`},
		{"readonly-tuple", "readonly [string,number]", `["ok",7]`},
		{"record", "Record<string,number>", "{a:7}"},
		{"readonly-record", "Readonly<Record<string,number>>", "{a:7}"},
		{"nested", "{active:boolean}", "{active:true}"},
	} {
		add("mapping-"+c.name, data, "In this table, `S`, `A` and `B` are the recursively mapped schemas", "schema S = "+c.typ+"; const x:S="+c.value, "", "vip-decls")
	}
	add("data-readonly", data, "Variant payload properties are readonly in the resulting type", `data D { V { n:number } }; function f(d:D) { d.n=2 }`, "TS2540", "vip-core2")
	add("data-optional", data, "[Field](900-appendices.md#field) and [Separator](900-appendices.md#separator) are those of `schema` declarations.", `data D { V { n?:number } }; const a:D=D.V({}); const b:D=D.V({n:undefined})`, "", "vip-core2")
	add("schema-reference", data, "Refinements and transformations stay Schema constants", `const N=Schema.NumberFromString; schema S { n:N }; const s:S={n:7}`, "", "vip-decls")

	for n := 1; n <= 4; n++ {
		params := []string{"First", "Second", "Third", "Fourth"}[:n]
		var fields, args []string
		for i, param := range params {
			fields = append(fields, fmt.Sprintf("f%d:%s", i, param))
			args = append(args, "number")
		}
		for bad := range n {
			var values []string
			for i := range n {
				value := "7"
				if i == bad {
					value = `"wrong"`
				}
				values = append(values, fmt.Sprintf("f%d:%s", i, value))
			}
			source := "data G<" + strings.Join(params, ",") + "> { V { " + strings.Join(fields, ";") + " } }; const g:G<" + strings.Join(args, ",") + ">=G.V({" + strings.Join(values, ",") + "})"
			add(fmt.Sprintf("generic-%d-position-%d", n, bad+1), data, "Parameters map by position to `this[\"A\"]`, `this[\"B\"]`, `this[\"C\"]` and `this[\"D\"]`, whatever their source names.", source, "TS2322", "vip-core2")
		}
	}

	add("generic-default", data, "defaults such as `<A = string>` are compile errors", `data Box<A = string> { Value { value:A } }`, "EK2803", "vip-core2")
	for _, c := range []struct{ name, pattern string }{
		{"empty-extractor", "A()"}, {"constrained-extractor", `A({ id: "x" })`},
	} {
		add("exhaustive-"+c.name, match, "`when NotFound():` and `when NotFound({ id: \"x\" }):` cover nothing.", `error A { id:string }; function f(x:A) { return match(x) { when `+c.pattern+`: 1; } }`, "EK4701", "vip-match")
	}
	for _, c := range []struct{ name, decl string }{
		{"alias", "type T = string"}, {"interface", "interface T { x:string }"}, {"class", "class T {}"}, {"enum", "enum T { A }"},
	} {
		add("schema-nonvalue-"+c.name, data, "a reference without a Schema value is `EK2109`", c.decl+`; schema S { x:T }`, "EK2109", "vip-decls")
	}
	add("schema-key-types", data, "string, numeric or computed field key", `const key:unique symbol=Symbol(); schema S { "text":string; 7:number; [key]:boolean }; const s:S={"text":"ok",7:1,[key]:true}`, "", "vip-decls")
	add("data-variant-newline", data, "A variant's `{` starts its field body even after line breaks", "data D { V\n\n{ n:number }; W }; const d:D=D.V({n:1})", "", "vip-core2")
	for _, decl := range []string{"schema", "data"} {
		for _, name := range []string{"as", "satisfies"} {
			add(decl+"-body-required-"+name, data, "Unlike `error`, neither has a bodyless form.", "const "+decl+"=1; type T=number; "+decl+" "+name+" T;", "error", "vip-decls")
		}
	}

	for _, c := range []struct{ name, member string }{
		{"initializer", "id = 1"}, {"private", "private id:string"}, {"private-name", "#id = 1"}, {"declare", "declare id:string"}, {"accessor", "accessor id = 1"}, {"index", "[id:string]:string"},
	} {
		add("schema-error-member-"+c.name, errors, "any other member that is not a [Field](900-appendices.md#field), a method, a getter or an empty `;` class element", "schema error E { "+c.member+" }", "EK1304", "vip-decls")
	}

	add("empty-data-never", data, "Zero variants are allowed", `data Empty {}; const x:Empty={_tag:"Unexpected"}`, "TS2322", "vip-core2")

	for n := 1; n <= 4; n++ {
		params := []string{"First", "Second", "Third", "Fourth"}[:n]
		args := []string{"string", "number", "boolean", "bigint"}[:n]
		values := []string{`"first"`, "7", "true", "7n"}[:n]
		var fields, payload []string
		for i, param := range params {
			fields = append(fields, fmt.Sprintf("f%d:%s", i, param))
			payload = append(payload, fmt.Sprintf("f%d:%s", i, values[i]))
		}
		add(fmt.Sprintf("generic-%d-distinct-positions", n), data, "Parameters map by position", "data G<"+strings.Join(params, ",")+"> { V { "+strings.Join(fields, ";")+" } }; const g:G<"+strings.Join(args, ",")+">=G.V({"+strings.Join(payload, ",")+"})", "", "vip-core2")
	}

	add("schema-keyword-name-as", "006-data.md", "the keyword and the name on one line, where a declaration can start", "schema as = string; const x:as=\"ok\"", "", "vip-decls")
	add("data-keyword-name-as", "006-data.md", "the keyword and the name on one line, where a declaration can start", "data as { V }; const x:as=as.V()", "", "vip-decls")
	add("schema-keyword-name-satisfies", "006-data.md", "the keyword and the name on one line, where a declaration can start", "schema satisfies = string; const x:satisfies=\"ok\"", "", "vip-decls")
	add("data-keyword-name-satisfies", "006-data.md", "the keyword and the name on one line, where a declaration can start", "data satisfies { V }; const x:satisfies=satisfies.V()", "", "vip-decls")
	add("schema-named-error-body", "003-failures.md", "`schema error { id: string }` is a schema named `error`", "schema error { id:string }; const x:error={id:\"ok\"}", "", "vip-decls")
	add("schema-body-newline", "006-data.md", "schema Address\n{ city: string }", "schema S\n{ n:number }; const x:S={n:1}", "", "vip-decls")
	add("schema-alias-newline", "006-data.md", "schema Code\n  = \"root_missing\" | \"read_failed\"", "schema S\n = \"a\" | \"b\"; const x:S=\"a\"", "", "vip-decls")
	add("data-body-newline", "006-data.md", "data Delivery\n{", "data D\n{ V }; const x:D=D.V()", "", "vip-decls")
	add("schema-type-continuation", "006-data.md", "a line break separates members only after the type is complete", "schema S { role:\n | \"a\"\n | \"b\"\n }; const x:S={role:\"a\"}", "", "vip-decls")
	add("data-written-readonly", "006-data.md", "a variant's fields may be `readonly`", "data D { V { readonly n:number } }; const x:D=D.V({n:1})", "", "vip-core2")
	add("schema-field-separator", "006-data.md", "Fields use TypeScript's type-member separators", "schema S { a:string b:number }", "error", "vip-decls")
	add("schema-error-field-separator", "006-data.md", "Fields use TypeScript's type-member separators", "schema error E { a:string b:number }", "error", "vip-decls")
	add("data-field-separator", "006-data.md", "Fields use TypeScript's type-member separators", "data D { V { a:string b:number } }", "error", "vip-decls")
	add("schema-error-priority-tag-initializer", "003-failures.md", "Otherwise a member gets one diagnostic: the first row that names it.", "schema error E { _tag = 1 }", "only:EK2117", "vip-decls")
	add("schema-error-priority-static-initializer", "003-failures.md", "Otherwise a member gets one diagnostic: the first row that names it.", "schema error E { static x = 1 }", "only:EK1302", "vip-decls")
	add("schema-error-priority-setter", "003-failures.md", "Otherwise a member gets one diagnostic: the first row that names it.", "schema error E { set x(v:number) {} }", "only:EK1302", "vip-decls")
	add("schema-error-priority-constructor", "003-failures.md", "Otherwise a member gets one diagnostic: the first row that names it.", "schema error E { constructor(){super({})} }", "only:EK1301", "vip-decls")

	add("combined-guard-grouped", "../vips/tc39-pattern-matching/explainer.md", "there is no precedence relationship between them.", "function f(x:number){return match(x){when (if(x>0) and if(x<10)) or if(x===100):1;default:0;}}", "", "vip-match")
	add("combined-guard-ungrouped", "../vips/tc39-pattern-matching/explainer.md", "there is no precedence relationship between them.", "function f(x:number){return match(x){when if(x>0) and if(x<10) or if(x===100):1;default:0;}}", "error", "vip-match")
	add("not-guard-grouped", "../vips/tc39-pattern-matching/explainer.md", "there is no precedence relationship between them.", "function f(x:number){return match(x){when (not if(x>0)) and if(x<10):1;default:0;}}", "", "vip-match")
	add("not-guard-ungrouped", "../vips/tc39-pattern-matching/explainer.md", "there is no precedence relationship between them.", "function f(x:number){return match(x){when not if(x>0) and if(x<10):1;default:0;}}", "error", "vip-match")

	add("data-constructor-nothrow", data, "A generated variant constructor has the static contract `@throws {never}`", `data D { V { n:number } }; effect function f() { return D.V({n:1}) }`, "", "vip-core2")
	add("schema-error-constructor-nothrow", errors, "A generated `schema error` constructor has thrown type `never`", `schema error E { n:number }; effect function f() { return new E({n:1}) }`, "", "vip-decls")
	add("schema-reference-alias", data, "Imports and shadowing follow TypeScript value lookup.", `import { NumberFromString as Parsed } from "effect/Schema"; schema S { n:Parsed }; const s:S={n:7}`, "", "vip-decls")
	add("schema-reference-shadow", data, "a type of the same name is not expanded.", `type Count=boolean; const Count=Schema.NumberFromString; schema S { n:Count }; const s:S={n:7}`, "", "vip-decls")
	add("async-match-direct", match, "Inside effect code, a direct `async match` is a compile error", `effect function f(){return async match(true){default:1;}}`, "error", "vip-match")
	add("async-match-effect-try", match, "`await` is allowed there and effect `try` is not", `effect function f(){return try promise(()=>async match(true){default:try succeed(1);})}`, "error", "vip-match")

	rules = append(rules, dataExhaustivenessRules()...)
	rules = append(rules, dataHelperNameRules()...)
	rules = append(rules, dataTaggedMembersRules()...)
	rules = append(rules, dataDeclarationRules()...)
	return rules
}

const dataRuleTarget = "FuzzDataSpecRules"

func checkDataRule(t *testing.T, w *Workspace, c dataRule, trivia uint8) {
	t.Helper()
	if !strings.Contains(SpecText(c.chapter), c.quote) {
		t.Fatalf("stale oracle %s: chapter %s no longer says %q", c.name, c.chapter, c.quote)
	}
	source := strings.Repeat("/* trivia */\n", int(trivia)%4) + c.source + "\nexport {}\n"
	files := map[string]string{"main.vibe": source}
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	r.Diagnostics = append(r.Diagnostics, dataDeclarationDiagnostics(t, w, c, r)...)
	checkDataHelperName(t, c, r)
	wantCode := strings.TrimPrefix(c.code, "only:")
	var got []string
	matched := false
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		got = append(got, specDiagnosticText(d))
		match := wantCode == "error" || diagnosticKey(d) == wantCode
		if c.name == "generic-limit" {
			// "the message names the limit"
			match = match && (strings.Contains(specDiagnosticText(d), "4") || strings.Contains(specDiagnosticText(d), "four"))
		}
		matched = matched || match
	}
	if strings.HasPrefix(c.code, "only:") && len(got) != 1 {
		matched = false
	}
	key := "feature:" + c.name
	if (c.code == "" && len(got) > 0) || (c.code != "" && !matched) {
		Gap(t, dataRuleTarget, key, "%s: %q; expected diagnostic %q (empty means acceptance), got %v\n%s", c.chapter, c.quote, c.code, got, Archive(files))
	}
	ExpectPending(t, dataRuleTarget, key)
	if corpus := specCorpusKey(t); corpus != "" {
		ExpectPending(t, dataRuleTarget, corpus)
	}
}

func TestDataSpecRules(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range dataRules() {
		t.Run(c.name, func(t *testing.T) { checkDataRule(t, w, c, 0) })
	}
}

// TestDataSpecRulesQuoted runs in the gate (specTests in the root
// PACKAGE.ts), so a chapter edit that rewords a quoted rule updates the
// quote in the same change.
func TestDataSpecRulesQuoted(t *testing.T) {
	for _, c := range dataRules() {
		if !strings.Contains(SpecText(c.chapter), c.quote) {
			t.Errorf("%s: chapter %s no longer says %q; update the quote", c.name, c.chapter, c.quote)
		}
		code := strings.TrimPrefix(c.code, "only:")
		if strings.HasPrefix(code, "EK") && !strings.Contains(SpecText(c.chapter), code) {
			t.Errorf("%s: chapter %s no longer specifies %s", c.name, c.chapter, code)
		}
	}
}

// FuzzDataSpecRules picks a rule by its name, so a saved input keeps its
// meaning when the list changes; any other input indexes the list by its
// first byte.
func FuzzDataSpecRules(f *testing.F) {
	startShortBudget(f)
	cases := dataRules()
	for _, c := range cases {
		f.Add(c.name, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		i := slices.IndexFunc(cases, func(c dataRule) bool { return c.name == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(cases)
		}
		checkDataRule(t, w, cases[i], trivia)
	})
}
