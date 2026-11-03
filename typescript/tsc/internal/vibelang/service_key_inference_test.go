package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestServiceKeyResultInference(t *testing.T) {
	for _, read := range []string{"Key.key", "Key[\"key\"]", "Alias.key", "key"} {
		t.Run(read, func(t *testing.T) {
			source := `service Key { static readonly key = "app/Key"; value: number }
const Alias = Key
const { key } = Key
function read() { return ` + read + ` }
const exact: "app/Key" = read()
export { exact }
`
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
		})
	}
}

func TestServiceKeyInferenceFix(t *testing.T) {
	source := `service Key { static readonly key = "app/Key"; value: number }
export function read() { let value = Key.key; value = "other"; return value }
`
	p, file, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{VIPOnly: true})
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("--fix failed: %+v", result)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, "let value: string = Key.key") {
		t.Fatalf("--fix did not preserve the mutable binding: %+v", fixed)
	}
	if errors := errorsOf(t, fixed.Text); len(errors) != 0 {
		t.Fatalf("fixed source reports %v", errors)
	}
}

func TestServiceKeyInferenceKeepsWrittenAndReferenceTypes(t *testing.T) {
	for _, declaration := range []string{
		`service Key { static readonly key: string = "app/Key"; value: number }`,
		`service Key { static readonly key = "app/Key"; static readonly defaultValue = () => ({ value: 1 }); value: number }`,
		`class Key { static readonly key = "app/Key" }`,
	} {
		p, file, _, _ := editorProgram(t, declaration+`
function read() { return Key.key }
const value: ReturnType<typeof read> = "other"
export { value }
`)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("unexpected diagnostic: %s", d.String())
			}
		}
	}
}
