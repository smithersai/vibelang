package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaExactOptionalAssignment(t *testing.T) {
	const source = `schema Item { value?: string; label?: string | undefined }
const omitted: Item = {}
const allowed: Item = { label: undefined }
const explicit: Item = { value: undefined }`
	for _, exact := range []bool{false, true} {
		t.Run(fmt.Sprintf("exact=%t", exact), func(t *testing.T) {
			config := fmt.Sprintf(`{"compilerOptions":{"module":"NodeNext","strict":true,"skipLibCheck":true,"exactOptionalPropertyTypes":%t},"files":["main.vibe"]}`, exact)
			program, file, _, _ := editorProgramConfig(t, source, editorPackageJSON, editorPackages, config)
			rejected := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 2375 && d.Pos() == strings.Index(source, "explicit:") {
					rejected = true
				} else {
					t.Errorf("unexpected diagnostic: %v", d)
				}
			}
			if rejected != exact {
				t.Errorf("explicit undefined rejected = %t, want %t", rejected, exact)
			}
		})
	}
}

func TestSchemaOptionalStructAdvice(t *testing.T) {
	const source = `const Optional = Schema.Struct({ value: Schema.optional(Schema.String) })
const Exact = Schema.Struct({ value: Schema.optionalKey(Schema.String) })
const Union = Schema.Struct({ value: Schema.optional(Schema.Union([Schema.String, Schema.Undefined])) })`
	program, file, _, _ := editorProgram(t, source)
	var names []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("unexpected diagnostic: %v", d)
		}
		if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
			names = append(names, source[d.Pos():d.End()])
		}
	}
	if len(names) != 1 || names[0] != "Optional" {
		t.Errorf("EK4832 reported on %v, want only Optional", names)
	}
}
