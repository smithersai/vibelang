package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCommonJSThrowsAttachment(t *testing.T) {
	for _, shape := range []struct{ name, assignment, importClause string }{
		{"exports", "exports.parse = function(value) { return value.length }", "{ parse }"},
		{"module-property", "module.exports.parse = function(value) { return value.length }", "{ parse }"},
		{"computed-property", "exports[\"parse\"] = function(value) { return value.length }", "{ parse }"},
		{"default-export", "module.exports = function(value) { return value.length }", "parse"},
		{"arrow", "exports.parse = (value) => value.length", "{ parse }"},
		{"parenthesized", "exports.parse = (function(value) { return value.length })", "{ parse }"},
		{"declared-function", "function parse(value) { return value.length }; exports.parse = parse", "{ parse }"},
	} {
		for _, contract := range []string{"RangeError", "never", "unknown", "untagged"} {
			for _, context := range []string{"effect", "plain", "caught", "wrapped"} {
				t.Run(fmt.Sprintf("%s/%s/%s", shape.name, contract, context), func(t *testing.T) {
					annotation := "/**\n * @param {string} value\n * @returns {number}\n"
					if contract != "untagged" {
						annotation += " * @throws {" + contract + "}\n"
					}
					lib := annotation + " */\n" + shape.assignment + "\n"
					head, body := "", "return parse(\"ok\")"
					if context == "effect" || context == "wrapped" {
						head = "effect "
					}
					if context == "caught" {
						body = "try { return parse(\"ok\") } catch { return -1 }"
					}
					if context == "wrapped" {
						body = "return try Effect.try(() => parse(\"ok\"))"
					}
					source := "import " + shape.importClause + " from \"./foreign.cjs\"\nexport " + head + "function probe() {" + body + "}\n"
					p, f, _, _ := editorProgramAt(t, "main.vibe", `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowJs":true,"checkJs":false}`, source, editorPackageJSON, editorPackages)
					if err := os.WriteFile(filepath.Join(filepath.Dir(f.FileName().AsString()), "foreign.cjs"), []byte(lib), 0600); err != nil {
						t.Fatal(err)
					}
					p = compiler.NewProgram(compiler.ProgramOptions{Config: p.CommandLine(), Host: p.Host()})
					f = p.GetSourceFile(f.FileName())
					want := int32(0)
					if context == "effect" && contract != "never" {
						want = 403
					}
					if context == "plain" && contract != "never" && contract != "untagged" {
						want = 401
					}
					count := 0
					for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						count++
						if want == 0 || d.Source() != diagnosticSource || d.Code() != want {
							t.Errorf("unexpected: %s", d.String())
						}
					}
					n := 0
					if want != 0 {
						n = 1
					}
					if count != n {
						t.Errorf("got %d errors, want %d (EK%04d)", count, n, want)
					}
				})
			}
		}
	}
}
