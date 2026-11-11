package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestAliasedTopBottomThrowsContract(t *testing.T) {
	for _, source := range []string{"any", "Loose", "unknown", "Opaque", "never", "Nil", "string", "Text"} {
		for _, target := range []string{"any", "Loose", "unknown", "Opaque", "never", "Nil", "string", "Text"} {
			for _, ext := range []string{"ts", "d.ts"} {
				for _, site := range []string{"assignment", "argument", "implements"} {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", source, target, ext, site), func(t *testing.T) {
						t.Parallel()
						lib := fmt.Sprintf(`export type Nil=never;export type Opaque=unknown;export type Loose=any;export type Text=string;
/** @throws {%s} */
export declare function risky():number
export type Target={
/** @throws {%s} */
():number
}
export interface Requirement { run:Target }
/** @throws {never} */
export declare function accept(callback:Target):number
`, source, target)
						body := "export const selected:Target=risky"
						if site == "argument" {
							body = "accept(risky)"
						}
						if site == "implements" {
							body = "export class Holder implements Requirement { run=risky }"
						}
						code := "import{risky,Target,Requirement,accept}from\"./lib.js\"\n" + body
						p, f, _, _ := requirementIdentityProgram(t, code, map[string]string{"lib." + ext: lib})
						got := 0
						for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							got++
							if d.Source() != diagnosticSource || d.Code() != 402 {
								t.Errorf("unexpected: %s", d.String())
							}
						}
						canonical := func(s string) string {
							switch s {
							case "Nil":
								return "never"
							case "Opaque":
								return "unknown"
							case "Loose":
								return "any"
							case "Text":
								return "string"
							}
							return s
						}
						src, dst := canonical(source), canonical(target)
						admitted := dst == "any" || dst == "unknown" || src == "never" || src == "any" && dst != "never" || src == "string" && dst == "string"
						want := 1
						if admitted {
							want = 0
						}
						if got != want {
							t.Errorf("EK0402 got%d want%d", got, want)
						}
					})
				}
			}
		}
	}
}
