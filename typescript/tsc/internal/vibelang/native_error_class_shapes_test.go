package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// D284 and the 2026-11-04 native-error-class ruling: native spread fields
// and written static _tag members have no declaration advisory or repair.
// Query the planner directly too: an editor may send a stale diagnostic.
// rule-evidence: docs/design/src/007-tooling.md#typescript-spellings-with-vibelang-forms | A native `Schema.TaggedError` class with spread fields, or a native `Data.TaggedError` or `Schema.TaggedError` class with a user-written static `_tag`, keeps its class form without an error-declaration warning or quick fix.
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

// Native Effect classes with spread fields or a written static _tag have no
// declaration advisory. Ordinary fields remain eligible for a preserving fix.
// rule-evidence: docs/design/src/007-tooling.md#typescript-spellings-with-vibelang-forms | A native `Schema.TaggedError` class with spread fields, or a native `Data.TaggedError` or `Schema.TaggedError` class with a user-written static `_tag`, keeps its class form without an error-declaration warning or quick fix.
func FuzzNativeErrorClassShapes(f *testing.F) {
	for shape := uint8(0); shape < 4; shape++ {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(shape, mode)
		}
	}
	f.Fuzz(func(t *testing.T, shape, mode uint8) {
		spread, static := shape&1 != 0, shape&2 != 0
		schema := mode&1 == 0
		fields := "id: Schema.String"
		prefix, body := "", ""
		if schema && spread {
			prefix = "const fields = { id: Schema.String }\n"
			fields = "...fields, count: Schema.Number"
		}
		if static {
			body = "static readonly _tag = \"Native\""
			if mode&2 != 0 {
				body = "static get [\"_tag\"](): string { return \"Native\" }"
			}
		}
		code := int32(4837)
		source := prefix + "export class Native extends Schema.TaggedError<Native>()(\"Native\", {" + fields + "}) {" + body + "}\n"
		if !schema {
			code = 4830
			source = "export class Native extends Data.TaggedError(\"Native\")<{ readonly id: string }> {" + body + "}\n"
		}
		if mode&2 != 0 {
			source = "// café 😀\n" + source
		}
		exempt := static || schema && spread
		program, file, _, _ := editorProgram(t, source)
		count := 0
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("invalid generated class: %s\n%s", d.String(), source)
			}
			if d.Source() == diagnosticSource && d.Code() == code {
				count++
			}
		}
		want := 1
		if exempt {
			want = 0
		}
		if count != want {
			t.Fatalf("got %d EK%d, want %d (spread=%t static=%t schema=%t)\n%s", count, code, want, spread, static, schema, source)
		}
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		defer done()
		var class *ast.Node
		for _, statement := range file.Statements.Nodes {
			if ast.IsClassDeclaration(statement) {
				class = statement
				break
			}
		}
		rewrite := errorClassRewrite(c, file, class)
		if exempt {
			if rewrite.fixable() {
				t.Fatalf("native class has a stale-diagnostic fix: %+v", rewrite)
			}
		} else {
			if !rewrite.fixable() {
				t.Fatalf("ordinary class lost its fix: %+v", rewrite)
			}
		}
	})
}

func TestNativeErrorClassOrdinaryFixControls(t *testing.T) {
	for _, schema := range []bool{false, true} {
		t.Run(fmt.Sprint(schema), func(t *testing.T) {
			code, source := int32(4830), "export class Native extends Data.TaggedError(\"Native\")<{ readonly id: string }> {}"
			if schema {
				code, source = 4837, "export class Native extends Schema.TaggedError<Native>()(\"Native\", {id: Schema.String}) {}"
			}
			fixed := applyQuickFix(t, source, code)
			if fixed == source || !strings.Contains(fixed, "error Native") {
				t.Fatalf("ordinary class lost its editor repair:\n%s", fixed)
			}
		})
	}
}
