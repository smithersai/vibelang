package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectConstructorPrefixPreservingFix(t *testing.T) {
	for _, test := range []struct{ source, fixed string }{
		{"class C { effect constructor() {} }", "class C {  constructor() { return effect {}; } }"},
		{"class C { effect /* prefix */ 'constructor'() { return this } }", "class C {  /* prefix */ 'constructor'() { return effect { return this }; } }"},
		{"const café = '😀'; class C { private effect constructor() { return 1 } }", "const café = '😀'; class C { private  constructor() { return effect { return 1 }; } }"},
		{"class C { effect constructor() { /* body */ return 1 /* tail */ } }", "class C {  constructor() { return effect { /* body */ return 1 /* tail */ }; } }"},
		{"class C { effect constructor() { const effect = 1; return effect } }", "class C {  constructor() { return effect { const effect = 1; return effect }; } }"},
		{"class C { effect constructor() { const Effect = 1; return Effect } }", "class C {  constructor() { return effect { const Effect = 1; return Effect }; } }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			proposal := fileFixes(t.Context(), program, file, nil, []int32{EK0104.Code})
			if len(proposal.fixes) != 1 {
				t.Fatalf("want preserving constructor fix; got %d", len(proposal.fixes))
			}
			got := proposal.text()
			if got != test.fixed {
				t.Fatalf("got %s; want %s", got, test.fixed)
			}
			checked, edited, _, _ := editorProgram(t, got)
			for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed constructor: %s", d.String())
				}
			}
			again := fileFixes(t.Context(), checked, edited, nil, []int32{EK0104.Code})
			if len(again.fixes) != 0 || again.text() != got {
				t.Fatal("constructor fix is not idempotent")
			}
			if strings.Count(got, "return effect {") != 1 {
				t.Fatal("constructor body must retain exactly one cold Effect")
			}
		})
	}
}

func TestEffectConstructorPrefixFixRefusals(t *testing.T) {
	for _, source := range []string{
		"class C { effect get x() { return 1 } }",
		"class C { effect set x(v: number) {} }",
		"class C { constructor(arg = { effect get x() { return 1 } }) {} }",
		"class C { constructor(arg = { effect set x(v: number) {} }) {} }",
		"const o = { effect constructor() {} }",
		"class C { effect ['constructor']() {} }",
		"class C { constructor() {} }",
		"error E { effect constructor() {} }",
		"schema error E { effect constructor() {} }",
		"class C { effect constructor(value = 1) { return value } }",
		"class C { effect constructor(value: number) { return value } }",
		"class C { effect constructor(...values: number[]) { return values } }",
		"class C { effect constructor() { return new.target } }",
		"class C extends Object { effect constructor() { super() } }",
		"class C { async effect constructor() {} }",
		"class C { effect constructor<T>() {} }",
		"class C { effect constructor(): number!! {} }",
	} {
		program, file, _, _ := editorProgram(t, source)
		p := fileFixes(t.Context(), program, file, nil, []int32{EK0104.Code})
		if len(p.fixes) != 0 || p.text() != source {
			t.Fatalf("unsafe or unrelated rewrite: %s", p.text())
		}
	}
}

func TestEffectRestrictedErrorMemberPriority(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{
			"effect get x() { return 1 }",
			"effect set x(v: number) {}",
			"effect constructor() {}",
			"static effect get x() { return 1 }",
			"effect get _tag() { return 1 }",
			"effect get ['_tag']() { return 1 }",
			"effect /* modifier */ get \"_tag\"() { return 1 }",
			"effect set _tag(value: string) {}",
			"effect set ['_tag'](value: string) {}",
			"async effect get x() { return 1 }",
		} {
			source := "export " + form + " E { " + member + " }"
			t.Run(source, func(t *testing.T) {
				p, file, _, _ := editorProgram(t, source)
				found := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Source() != diagnosticSource {
						continue
					}
					if d.Code() == 104 {
						found++
					}
					if d.Code() == 1301 || d.Code() == 1302 || d.Code() == 1303 || d.Code() == 1304 || d.Code() == 2117 {
						t.Errorf("redundant error-body category: %s", d.String())
					}
				}
				if found != 1 {
					t.Fatalf("want exactly one EK0104; got %d", found)
				}
			})
		}
	}
}

func TestEffectRestrictedNestedMemberKeepsOuterCategory(t *testing.T) {
	for _, source := range []string{
		"export error E { set x(v: number) { class C { effect constructor() {} } } }",
		"export error E { static get x() { class C { effect constructor() {} }; return 1 } }",
	} {
		p, file, _, _ := editorProgram(t, source)
		found := map[int32]int{}
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Source() == diagnosticSource {
				found[d.Code()]++
			}
		}
		if found[104] != 1 || found[1302] != 1 {
			t.Fatalf("nested prefix suppressed an unrelated member category: %v", found)
		}
	}
}

func TestEffectRestrictedOuterMemberKeepsNestedCategory(t *testing.T) {
	source := "export error E { effect set x(v: number) { error Inner { constructor() {} } } }"
	p, file, _, _ := editorProgram(t, source)
	found := map[int32]int{}
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Source() == diagnosticSource {
			found[d.Code()]++
		}
	}
	if found[104] != 1 || found[1301] != 1 || found[1302] != 0 {
		t.Fatalf("forbidden outer setter suppressed nested constructor category: %v", found)
	}
}

// The priority rule removes the duplicate VibeLang category, not native
// property compatibility or errors inside the written getter.
func TestEffectRestrictedErrorMemberKeepsNativeDiagnostics(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, result := range []string{"1", "missing"} {
			p, file, _, _ := editorProgram(t, "export "+form+" E { effect get _tag() { return "+result+" } }")
			counts := map[int32]int{}
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				counts[d.Code()]++
			}
			native := int32(2416)
			if result == "missing" {
				native = 2304
			}
			if counts[104] != 1 || counts[2117] != 0 || counts[native] == 0 {
				t.Fatalf("%s/%s: need modifier + independent TS%d, without tag category: %v", form, result, native, counts)
			}
		}
	}
}
