package vipgen

import (
	"fmt"
	"strings"
)

// The static target owns rejection and diagnostic oracles. This construct
// owns semantics and uses the existing Exit/event comparator, not a second
// runner. Native TypeScript, transpiled by stock tsc, is the reference.
func init() {
	Register(&Construct{
		Key: "vip17.soft-keyword-identifiers-plain", VIP: 17, Plain: true,
		Citations: []Citation{{
			VIP: 17, Template: "ev(‹identifier›())",
			Quote:   "Outside effect code they are identifiers.",
			Reading: "Appendix A extends the ordinary TypeScript identifier reading to contextual words outside their syntactic productions and to all property names. The TypeScript twin is transpiled by stock TypeScript and never by VibeLang; native-invalid and Effect-reserved bindings are checked by FuzzSoftKeywordBindings.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{softKeywordObservation(g, s)} },
		Stmt:  softKeywordObservation,
	})
}
func softKeywordObservation(g *Gen, s *Scope) Stmt {
	// Choose words that are native strict-mode identifiers. All native reserved
	// words still participate as property names, with the full static matrix
	// responsible for their rejected binding shapes.
	word := SoftKeywordWords[g.Intn(len(SoftKeywordWords))]
	form := SoftKeywordForms[g.Intn(len(SoftKeywordForms))]
	home := []string{"plain", "field", "enum", "static", "module", "effect", "static-effect"}[g.Intn(7)]
	use := SoftKeywordUses[g.Intn(len(SoftKeywordUses))]
	if strings.Contains(" break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield await ", " "+word+" ") {
		form = "property"
	}
	if (home == "effect" || home == "static-effect") && (word == "fork" || word == "join") {
		form = "property"
	}
	if (home == "effect" || home == "static-effect") && form == "catch" {
		form = "const"
	}
	// A label in an Effect function is a LabelIdentifier even if its use is
	// in a class field/enum initializer.
	if (home == "field" || home == "enum") && (word == "fork" || word == "join") && form == "label" {
		form = "property"
	}
	shape := SoftKeywordShape{word, form, home, use}
	// Catch bindings keep native try/catch outside Effect code. For static
	// forms, the scope wrapper owns the catch while the use stays in the block.
	v, ts := shape.Sources()
	name := g.Name("keywordProbe")
	v = strings.ReplaceAll(v, "probe", name)
	ts = strings.ReplaceAll(ts, "probe", name)

	g.AddFile("soft-keyword-helper.ts", SoftKeywordHelper, "helper")

	compiler, reference := g.Name("stockKeyword"), g.Name("referenceKeyword")
	// Import bindings refer to an ordinary pure helper. Everything else is the
	// source TypeScript twin, including its native lexical scopes.
	ts = strings.ReplaceAll(ts, softKeywordImport(shape), "")
	ts = strings.ReplaceAll(ts, "export ", "")
	argument := ""
	parameters := ""
	if form == "import" {
		parameters = fmt.Sprintf("%q,", word)
		argument = "(n) => n + 7"
	}
	referenceDecl := fmt.Sprintf("const %s = (await import(\"node:module\")).createRequire(import.meta.resolve(\"effect\"))(\"typescript\");\nconst %s = new Function(%s \"return \" + %s.transpileModule(%q, { compilerOptions: { target: %s.ScriptTarget.ES2022, module: %s.ModuleKind.ESNext } }).outputText + \"\\nreturn %s;\")(%s);",
		compiler, reference, parameters, compiler, ts, compiler, compiler, name, argument)
	// A function declaration is not an expression: transpile first, append the
	// return, then instantiate. The outer new Function returns that callable.
	referenceDecl = strings.Replace(referenceDecl, "\"return \" + ", "", 1)
	v = strings.ReplaceAll(v, softKeywordImport(shape), "")
	v = strings.ReplaceAll(v, "export ", "")
	binding := ""
	if form == "import" {
		binding = "const " + word + " = helper; "
	}
	g.AddDecl(&Code{V: "const " + name + "Entry = (() => { " + binding + v + "; return " + name + "; })();", E: referenceDecl})
	call := name + "Entry()"
	if shape.EffectResult() {
		call = "Effect.runSync(" + call + ")"
		g.UseEffect()
	}
	return &Code{V: "ev(" + fmt.Sprintf("%q", shape.Key()) + "); ev(String(" + call + "))",
		E: "ev(" + fmt.Sprintf("%q", shape.Key()) + "); ev(String(" + reference + "()))"}
}
