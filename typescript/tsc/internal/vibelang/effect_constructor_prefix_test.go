package vibelang

import (
	"testing"
)

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
