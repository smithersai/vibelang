package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestPatternValueAdmissionDiagnostics(t *testing.T) {
	for _, value := range []string{"p", "holder.p", "holder[\"p\"]"} {
		for _, typ := range []string{"object", "Function", "unknown", "any", "{}"} {
			for _, form := range []string{"match", "is", "extract"} {
				t.Run(typ+"/"+value+"/"+form, func(t *testing.T) {
					source := "declare const p: " + typ + "; declare const holder: {p: " + typ + "}; export function f(s:unknown){ return "
					switch form {
					case "match":
						source += "match(s){when " + value + ":1;default:0;}"
					case "is":
						source += "s is " + value
					case "extract":
						source += "match(s){when " + value + "(let x):x;default:0;}"
					}
					source += "}"
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							if d.Code() != 702 {
								t.Errorf("unexpected: %s", d.String())
							}
							count++
						}
					}
					if count != 1 {
						t.Fatalf("want exactly one EK0702, got %d", count)
					}
				})
			}
		}
	}
}

func TestPatternValueAdmissionPreservingFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"object", `export function f(s:unknown,p:object){return match(s){when p:1;default:0;}}`, "$patternIs(p, $patternSubject)"},
		{"indexed", `export function f(s:unknown,holder:{p:Function}){return s is holder["p"]}`, `$patternIs(holder["p"], $patternSubject)`},
		{"extractor", `export function f(s:unknown,p:object){return match(s){when p(let x):x;default:0;}}`, "$patternExtract(p, $patternSubject) is [let x]"},
		{"comments", `export function f(s:unknown,p:object){return match(s){when p /* keep */ (let x):x;default:0;}}`, "p /* keep */ , $patternSubject) is [let x]"},
		{"inline-empty-extractor", `export function f(s:unknown,h:{p:Function}){return s is h["p"]()}`, `$patternExtract(h["p"], $patternSubject) is []`},
		{"rest", `export function f(s:unknown,p:object){return match(s){when p(let x,...let xs):[x,xs];default:0;}}`, "is [let x,...let xs]"},
		{"hygiene", `const $patternSubject=1,$patternIs=2; export function f(s:unknown,p:object){return match(s){when p:[$patternSubject,$patternIs];default:0;}}`, "$patternIs$1(p, $patternSubject$1)"},
		{"directive", `"use client"; export function f(s:unknown,p:object){return s is p}`, "\"use client\";\nimport {"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": test.source})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix failed: %v refusals=%+v", result.Err, result.Refused)
			}
			var fixed string
			for _, file := range result.Files {
				if file.Counts[702] > 0 {
					fixed = file.Text
				}
			}
			if !strings.Contains(fixed, test.want) {
				t.Fatalf("missing %q in\n%s", test.want, fixed)
			}
			again := fixProjectOf(t, map[string]string{"main.vibe": fixed})
			if again.Err != nil || len(again.Files) != 0 {
				t.Fatalf("fix not idempotent: %+v", again)
			}
		})
	}
}

func TestPatternValueAdmissionUnresolved(t *testing.T) {
	for _, value := range []string{"missing", `missing["p"]`, "missing.p"} {
		program, file, _, _ := editorProgram(t, "export function f(s:unknown){return s is "+value+"}")
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 702 {
				t.Errorf("extra EK0702: %s", d.String())
			}
			if d.Code() == 2304 {
				found = true
			}
		}
		if !found {
			t.Fatal("missing native unresolved-name diagnostic")
		}
	}
}

func TestPatternValueAdmissionFixRefusesChangedObservations(t *testing.T) {
	for _, source := range []string{
		`const String:object={}; export function f(s:unknown){return match(s){when String():1;default:0;}}`,
		`export function f(s:unknown,p:object){return match(s){when p:s;default:null;}}`,
		`function read():unknown{return 1}; export function f(p:object){return match(read()){when p:1;default:0;}}`,
	} {
		result := fixProjectOf(t, map[string]string{"main.vibe": source})
		if result.Err != nil || len(result.Files) != 0 {
			t.Fatalf("unsafe rewrite was applied to %q: %+v", source, result)
		}
	}
}
