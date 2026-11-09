package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestMatchLiteralDiscriminantWarning(t *testing.T) {
	for _, tc := range []struct{ name, domain, arms, missing string }{
		{"missing-kind", `{kind:"circle";r:number}|{kind:"square";side:number}`, `when {kind:"circle",let r}:r;`, "square"},
		{"boolean", `{kind:boolean}`, `when {kind:true}:1;`, "false"},
		{"bigint", `{kind:1n|2n}`, `when {kind:1n}:1;`, "2n"},
		{"null", `{kind:null|"a"}`, `when {kind:"a"}:1;`, "null"},
		{"undefined", `{kind:undefined|"a"}`, `when {kind:"a"}:1;`, "undefined"},
		{"computed-key", `{kind:"a"|"b"}`, `when {["kind"]:"a"}:1;`, "b"},
		{"two-discriminants", `{kind:"a"|"b";phase:1|2}`, `when {kind:"a"}:1;when {kind:"b",phase:1}:2;`, "2"},
		{"nested-payload", `{kind:"outer";value:{type:"a"}|{type:"b"}}`, `when {kind:"outer",value:{type:"a"}}:1;`, "b"},
		{"required-presence", `{kind:"a";x:number}`, `when {kind:"a",x}:1;`, ""},
		{"refutable-payload", `{kind:"a";x:number}`, `when {kind:"a",x:1}:1;`, "kind"},
		{"capture-and", `{kind:"a"|"b"}`, `when {kind:"a"} and let a:1;when {kind:"b"}:2;`, ""},
		{"all-kind", `{kind:"circle"}|{kind:"square"}`, `when {kind:"circle"}:1;when {kind:"square"}:2;`, ""},
		{"missing-type", `{type:"a"}|{type:"b"}`, `when {type:"a"}:1;`, "b"},
		{"arbitrary-key", `{phase:1}|{phase:2}`, `when {phase:1}:1;`, "2"},
		{"literal-union", `{kind:"a"|"b"}`, `when {kind:"a"}:1;`, "b"},
		{"literal-union-complete", `{kind:"a"|"b"}`, `when {kind:"a"}:1;when {kind:"b"}:2;`, ""},
		{"nested-missing", `{value:{kind:"a"}|{kind:"b"}}`, `when {value:{kind:"a"}}:1;`, "b"},
		{"nested-complete", `{value:{kind:"a"}|{kind:"b"}}`, `when {value:{kind:"a"}}:1;when {value:{kind:"b"}}:2;`, ""},
		{"mixed-tags", `{_tag:"a"}|{kind:"b"}`, `when {_tag:"a"}:1;`, "b"},
		{"mixed-tags-complete", `{_tag:"a"}|{kind:"b"}`, `when {_tag:"a"}:1;when {kind:"b"}:2;`, ""},
		{"open", `{kind:string}`, `when {kind:"a"}:1;`, ""},
		{"open-union", `{kind:"a"}|{kind:string}`, `when {kind:"a"}:1;`, ""},
		{"default", `{kind:"a"}|{kind:"b"}`, `when {kind:"a"}:1;default:2;`, ""},
		{"or", `{kind:"a"|"b"}`, `when {kind:"a"} or {kind:"b"}:1;`, ""},
		{"guard", `{kind:"a"}|{kind:"b"}`, `when {kind:"a"} and if(false):1;when {kind:"b"}:2;`, "a"},
		{"optional", `{kind?:"a"}`, `when {kind:"a"}:1;`, "kind"},
		{"optional-payload", `{kind:"a";x?:number}`, `when {kind:"a",let x}:1;`, "kind"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export function f(s:" + tc.domain + "){return match(s){" + tc.arms + "}}"
			p, f, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Source() == "EK" && d.Code() == 708 {
					count++
					if tc.name == "missing-kind" && (strings.Count(d.MessageText(), "square") < 2 || strings.Count(d.MessageText(), "circle") != 1) {
						t.Errorf("warning must name only the missing square case after its subject type: %s", d.MessageText())
					}
					if d.Category() != diagnostics.CategoryWarning {
						t.Errorf("category = %v", d.Category())
					}
					if tc.missing == "" || !strings.Contains(d.MessageText(), tc.missing) {
						t.Errorf("unexpected warning: %s", d.String())
					}
				} else {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			want := 0
			if tc.missing != "" {
				want = 1
			}
			if count != want {
				t.Errorf("warning count = %d, want %d", count, want)
			}
		})
	}
}

// Modern severity configuration must change the diagnostic, independently of
// the legacy configuration's adjustable-code list.
func TestLiteralDiscriminantSeverity(t *testing.T) {
	for _, severity := range []string{"warning", "error", "off"} {
		t.Run(severity, func(t *testing.T) {
			config := strings.TrimSuffix(editorTsconfig, "}") + `,"vibe":{"severities":{"EK0708":"` + severity + `"}}}`
			p, f, _, _ := editorProgramConfig(t, `export function f(s:{kind:"a"}|{kind:"b"}){return match(s){when {kind:"a"}:1;}}`, editorPackageJSON, editorPackages, config)
			ds := p.GetSemanticDiagnostics(t.Context(), f)
			if severity == "off" {
				if len(ds) != 0 {
					t.Fatalf("off: %v", ds)
				}
				return
			}
			want := diagnostics.CategoryWarning
			if severity == "error" {
				want = diagnostics.CategoryError
			}
			if len(ds) != 1 || ds[0].Code() != 708 || ds[0].Category() != want {
				t.Fatalf("%s: %v", severity, ds)
			}
		})
	}
}

func TestLiteralDiscriminantLargeUnion(t *testing.T) {
	var domain, arms []string
	for i := range 300 {
		domain = append(domain, fmt.Sprintf("{kind:%d}", i))
		if i != 299 {
			arms = append(arms, fmt.Sprintf("when {kind:%d}:0;", i))
		}
	}
	p, f, _, _ := editorProgram(t, "export function f(s:"+strings.Join(domain, "|")+"){return match(s){"+strings.Join(arms, "")+"}}")
	ds := p.GetSemanticDiagnostics(t.Context(), f)
	if len(ds) != 1 || ds[0].Code() != 708 || !strings.Contains(ds[0].MessageText(), "299") {
		t.Fatalf("large union: %v", ds)
	}
}

func TestLiteralDiscriminantMixedFixedPatterns(t *testing.T) {
	for _, source := range []string{
		`error Missing;export function f(s:Missing|{kind:"a"}){return match(s){when Missing:1;when {kind:"a"}:2;}}`,
		`export function f(s:Option.Option<number>|{kind:"a"}){return match(s){when Option.None:0;when Option.Some(let n):n;when {kind:"a"}:2;}}`,
		`export function f(s:Exit.Exit<number,string>|{kind:"a"}){return match(s){when Exit.Success(let n):n;when Exit.Failure(let c):0;when {kind:"a"}:2;}}`,
	} {
		p, f, _, _ := editorProgram(t, source)
		if ds := p.GetSemanticDiagnostics(t.Context(), f); len(ds) != 0 {
			t.Errorf("complete fixed patterns: %v\n%s", ds, source)
		}
	}
}

// Exhausted nested enumeration is unknown, never a missing-case witness.
func TestLiteralDiscriminantEnumerationBudget(t *testing.T) {
	var domain []string
	for i := range 257 {
		domain = append(domain, fmt.Sprintf("{kind:%d}", i))
	}
	source := `export function f(s:{kind:"outer";payload:{value:` + strings.Join(domain, "|") + `}}){return match(s){when {kind:"outer",payload:{value:{kind:0}}}:1;}}`
	p, f, _, _ := editorProgram(t, source)
	if ds := p.GetSemanticDiagnostics(t.Context(), f); len(ds) != 0 {
		t.Fatalf("exhausted enumeration: %v", ds)
	}
}
