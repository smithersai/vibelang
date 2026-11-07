package vibelangfuzz

import (
	"strings"
	"testing"
)

// The relational reading removes exactly the instantiation-expression
// alternatives, so a later MemberExpression edit cannot silently widen it.
func TestGrammarAdmissionRelationalReadingDropsTypeArguments(t *testing.T) {
	for _, l := range strings.Split(grammarTsSubset, "\n") {
		m := production.FindStringSubmatch(l)
		if m == nil || m[1] != "MemberExpression" {
			continue
		}
		d := grammarParseDef(m[1], strings.TrimSpace(l[strings.Index(l, "=")+1:]), 0)
		if got := len(d.alts) - len(grammarWithoutExpressionTypeArguments(d).alts); got != 2 {
			t.Fatalf("relational reading removed %d MemberExpression alternatives, want the 2 TypeArguments ones", got)
		}
		return
	}
	t.Fatal("the TypeScript subset has no MemberExpression")
}

// Valid TypeScript the lab once failed to derive: a class expression's type
// parameters (ClassExpression: class BindingIdentifier? TypeParameters?
// ClassHeritage? { ClassBody }), a class field's definite assignment `!` on
// the name's line (parsePropertyDeclaration), an exported import alias, a type parameter list's
// trailing comma, type-literal accessor signatures (parseTypeMember reads `get`
// and `set` with no line-break rule), and a relational `<` whose right operand starts a type operator, which
// TypeScript's rewound type-argument parse leaves to ASI.
func TestGrammarAdmissionLabTypeScriptReadings(t *testing.T) {
	for _, source := range []string{
		"x = class <T> {};",
		"x = class C<T> {};",
		"x = class C<T> extends B { a:\nT\nT };",
		"schema % class < T >\n{ }",
		"schema % class\nC < T >\n{ a :\nT\nT }",
		"C < readonly\n{\nT\nT }",
		"C\n< readonly\n{\nT\nT }",
		"C < keyof\n{\nT\nT }",
		"const f = g<string>;\nconst n = a < b;",
		"const f = g<string>\n{\nT\nT }",
		"const C = class < T > { a ! : T } ;",
		"const C = class\n< T > { a ! : T }\n; ;",
		"class C { a!: number; b?: string; c! = 1 }",
		"export import value = of;",
		"export\nimport value = of ;",
		"export import type Value = of;",
		"const C = class < T , > { a ?\n: T } ;",
		"type T = { get service ( ) };",
		"type async = { get service\n( ) : void } ;",
		"type T = { get\nsize(): number; set size(v: number) };",
		"type T = { get: number; set(v: number): void };",
		"function f<T,>(x: T) { return x; }",
	} {
		if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
			t.Errorf("valid TypeScript has no lab derivation: %q: %s", source, detail)
		}
	}
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	rel, err := admissionRelationalLab()
	if err != nil {
		t.Fatal(err)
	}
	// The fallback adds ASI only where a line break allows it.
	for _, source := range []string{
		"C < readonly\n{ T T }",
		"x = class <T> T {};",
		"x = class <> {};",
		"class C { a\n!: number }",
		"class C { a?!: number }",
		"x = class <T,,> {};",
		"type T = { get size() { return 1; } };",
		"type T = { set size() };",
		"export import value from \"missing\";",
	} {
		toks := grammarLexSource(source)
		mode := grammarParseMode{prose: true, names: true}
		if r := lab.read(lab.g, toks, mode); r.count != 0 {
			t.Errorf("invalid sentence derives: %q", source)
		}
		if r := rel.read(rel.g, toks, mode); r.count != 0 {
			t.Errorf("relational reading derives an invalid sentence: %q", source)
		}
	}
}
