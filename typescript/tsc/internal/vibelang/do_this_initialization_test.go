package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// RC-34, VIP-2: moving a later do before this must neither hide TS17009
// nor change its source range. The native diagnostic twin evaluates the
// same operand before a following super call; runtime cases use arrow IIFEs.
func TestDoThisInitializationDiagnostics(t *testing.T) {
	for _, expression := range []string{
		"[this, VALUE]",
		"take(this, VALUE)",
		"this[KEY]",
		"this.x = VALUE",
		"this[KEY] = 2",
	} {
		for _, initialized := range []bool{false, true} {
			for _, lexical := range []bool{false, true} {
				name := expression
				if initialized {
					name += "/initialized"
				}
				if lexical {
					name += "/arrow"
				}
				t.Run(name, func(t *testing.T) {
					prefix := ""
					if initialized {
						prefix = "super(); "
					}
					wrap := func(expr string) string {
						if lexical {
							return "const read = (): void => { " + expr + "; }; read();"
						}
						return expr + ";"
					}
					source := func(value, key, tail string) string {
						expr := strings.NewReplacer("VALUE", value, "KEY", key).Replace(expression)
						return "export {}; class Base { x = 1 }; function take(receiver: object, value: number): void {}; class Derived extends Base { constructor() { " + prefix + wrap(expr) + tail + " } }"
					}
					body, vibeTail, nativeTail := "", "", ""
					if !initialized {
						nativeTail = "super();"
						if lexical {
							// TypeScript rejects super() inside arrow bodies.
							// Check the early lexical read with super after the
							// invocation; emit-only cases cover super in do too.
							vibeTail = "super();"
						} else {
							body = "super(); "
						}
					}
					vibe := source("do { "+body+"2 }", "do { "+body+"\"x\" as const }", vibeTail)
					control := source("2", "\"x\" as const", nativeTail)
					files := computedKeyFiles(false)
					files["/workspace/x/src/main.vibe"] = vibe
					files["/workspace/x/src/control.ts"] = control
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[],"skipLibCheck":true},"files":["main.vibe","control.ts"]}`
					p := computedKeyProgram(t, files)
					get := func(path string) []*ast.Diagnostic {
						file := p.GetSourceFile(tspath.RootedFilePath(path))
						ds := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
						var errors []*ast.Diagnostic
						for _, d := range ds {
							if d.Category() == diagnostics.CategoryError {
								errors = append(errors, d)
							}
						}
						return errors
					}
					got, want := get("/workspace/x/src/main.vibe"), get("/workspace/x/src/control.ts")
					count := 0
					if !initialized && !lexical {
						count = 1
					}
					if len(want) != count {
						t.Fatalf("native errors=%v, want %d", want, count)
					}
					if len(got) != len(want) {
						t.Fatalf("VibeLang errors=%v; native=%v", got, want)
					}
					for i, d := range got {
						native := want[i]
						if native.Code() != 17009 || d.Code() != native.Code() || d.Source() != native.Source() || d.MessageText() != native.MessageText() {
							t.Errorf("VibeLang=%v; native=%v", d, native)
						}
						if d.Loc() != native.Loc() || vibe[d.Loc().Pos():d.Loc().End()] != "this" {
							t.Errorf("source range=%v; native=%v", d.Loc(), native.Loc())
						}
					}
				})
			}
		}
	}
}
