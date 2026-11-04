package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D284 and the 2026-11-04 native-error-class ruling: native spread fields
// and written static _tag members have no declaration advisory or repair.
// Query the planner directly too: an editor may send a stale diagnostic.
func TestNativeErrorClassShapes(t *testing.T) {
	for _, alias := range []bool{false, true} {
		for _, schema := range []bool{false, true} {
			for _, member := range []string{"", `static readonly _tag = "Native"`, `static readonly "_tag" = "Native"`, `static readonly ["_tag"] = "Native"`, `static readonly [tag] = "Native"`} {
				for _, spread := range []bool{false, true} {
					if spread && !schema {
						continue
					}
					t.Run(fmt.Sprintf("alias=%t/schema=%t/spread=%t/member=%s", alias, schema, spread, member), func(t *testing.T) {
						prefix := `const tag = "_tag" as const
const shared = { cause: Schema.Defect() }
`
						dataBase, schemaBase := "Data.TaggedError", "Schema.TaggedError"
						if alias {
							prefix = `import { Data as D, Schema as S } from "effect"
` + prefix
							dataBase, schemaBase = "D.TaggedError", "S.TaggedError"
						}
						base := dataBase + `("Native")<{ readonly id: string }>`
						if schema {
							fields := "id: Schema.String"
							if spread {
								fields = "...shared, " + fields
							}
							base = schemaBase + `<Native>()("Native", { ` + fields + ` })`
						}
						source := prefix + "export class Native extends " + base + " { " + member + " }" + string(rune(10))
						program, file, _, _ := editorProgram(t, source)
						ds := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
						count := 0
						for _, d := range ds {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("invalid fixture: %s", d.String())
							}
							if d.Source() == diagnosticSource && (d.Code() == EK4830.Code || d.Code() == EK4837.Code) {
								count++
							}
						}
						native := spread || member != ""
						want := 1
						if native {
							want = 0
						}
						if count != want {
							t.Errorf("got %d error-class advisories, want %d", count, want)
						}
						c, done := program.GetTypeCheckerForFile(t.Context(), file)
						defer done()
						var class *ast.Node
						for _, statement := range file.Statements.Nodes {
							if ast.IsClassDeclaration(statement) {
								class = statement
							}
						}
						rewrite := errorClassRewrite(c, file, class)
						if native && rewrite.fixable() {
							t.Errorf("native class has stale-diagnostic repair: %+v", rewrite)
						}
						if !native && !rewrite.fixable() {
							t.Errorf("eligible control lost repair: %+v", rewrite)
						}
					})
				}
			}
		}
	}
}

// Exemptions apply to the fields object's own spread and static tag, not
// to a nested codec's spread or an unrelated static member.
func TestNativeErrorClassShapeBoundaries(t *testing.T) {
	for _, source := range []string{
		"export class Native extends Schema.TaggedError<Native>()(\"Native\", { id: Schema.String }) { static readonly label = \"kept\" }\n",
		"const shared = { id: Schema.String }\nexport class Native extends Schema.TaggedError<Native>()(\"Native\", { nested: Schema.Struct({ ...shared }) }) {}\n",
	} {
		program, file, _, _ := editorProgram(t, source)
		count := 0
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid control: %s", d.String())
			}
			if d.Source() == diagnosticSource && d.Code() == EK4837.Code {
				count++
			}
		}
		if count != 1 {
			t.Errorf("control got %d EK4837, want 1: %s", count, source)
		}
	}
}
