package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestReturnedSignatureOwnThrows(t *testing.T) {
	for _, ext := range []string{"ts", "d.ts"} {
		for _, outer := range []string{"never", "Error", "unknown"} {
			for _, inner := range []string{"never", "string", "unknown"} {
				for _, target := range []string{"never", "string", "unknown"} {
					for _, site := range []string{"assignment", "argument", "return", "satisfies", "implements"} {
						t.Run(fmt.Sprintf("%s/%s/%s/%s/%s", ext, outer, inner, target, site), func(t *testing.T) {
							lib := fmt.Sprintf(`export type Target = {
/** @throws {%s} */
():number
}
export interface Shape {run:Target}
/** @throws {never} */
export declare function accept(fn:Target):number
/** @throws {%s} */
export declare function create(): (
/** @throws {%s} */
()=>number
)
`, target, outer, inner)
							body := "const selected:Target=saved;return 0"
							result := ""
							switch site {
							case "argument":
								body = "return accept(saved)"
							case "return":
								result = ":Target"
								body = "return saved"
							case "satisfies":
								body = "const selected=saved satisfies Target;return 0"
							case "implements":
								body = "class Holder implements Shape {run=saved};return 0"
							}
							fallback := "return 0"
							if site == "return" {
								fallback = "return ()=>0"
							}
							source := "import {create,Target,Shape,accept} from './lib.js'\nexport function probe()" + result + "{try{const saved=create();" + body + "}catch{" + fallback + "}}"
							p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
							signatures := 0
							for _, file := range p.GetSourceFiles() {
								if !strings.HasSuffix(file.FileName().AsString(), "/lib."+ext) {
									continue
								}
								var visit func(*ast.Node) bool
								visit = func(n *ast.Node) bool {
									if ast.IsFunctionTypeNode(n) {
										signatures++
										if !hasThrowsTag(n) {
											t.Fatal("fixture @throws must attach to the returned function signature")
										}
									}
									return n.ForEachChild(visit)
								}
								file.AsNode().ForEachChild(visit)
							}
							if signatures != 1 {
								t.Fatalf("fixture has %d returned function signatures, want 1", signatures)
							}

							var codes []int32
							var errors []string
							for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
								if d.Category() == diagnostics.CategoryError {
									codes = append(codes, d.Code())
									errors = append(errors, d.String())
								}
							}
							admitted := inner == "never" || target == "unknown" || inner == "string" && target == "string"
							if admitted && len(codes) != 0 || !admitted && (len(codes) != 1 || codes[0] != 402) {
								t.Fatalf("admitted=%t; got %v", admitted, errors)
							}
						})
					}
				}
			}
		}
	}
}
