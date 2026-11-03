package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestCollectionExtractorPreservingFix(t *testing.T) {
	for _, source := range []string{
		"export function read(s: Map<string, number>): unknown { return match(s) { when Map(let m): m.get(123); default: undefined; } }",
		"export function read(s: Set<string>): boolean { return match(s) { when Set(const m): m.has(123); default: false; } }",
		"const Maps = Map; export function read(s: Map<string, number>): unknown { if (s is Maps(let m)) return m.get(123); return undefined; }",
		"export function read(s: { inner: Set<string> }): boolean { return match(s) { when {inner: Set(let m)}: m.has(123); default: false; } }",
	} {
		for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
			program, file, _, _ := editorProgram(t, source)
			ds := program.GetSemanticDiagnostics(t.Context(), file)
			found := false
			for _, d := range ds {
				if d.Code() == 2345 {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected specialized-key rejection: %v", ds)
			}
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("fix: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if !strings.Contains(fixed.Text, "m as Map<unknown, unknown>") && !strings.Contains(fixed.Text, "m as Set<unknown>") {
				t.Fatalf("missing preserving assertion: %s", fixed.Text)
			}
			if ds := errorsOf(t, fixed.Text); len(ds) != 0 {
				t.Fatalf("fixed errors: %v\n%s", ds, fixed.Text)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			second := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
			if len(second.Files) != 0 || len(second.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", second)
			}
		}
	}
}

func TestCollectionExtractorFixKeepsValidSpecialization(t *testing.T) {
	source := "export function read(s: Map<string, number>): Map<string, number> { return match(s) { when Map(let m): m; default: s; } }"
	program, _, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
	if len(result.Files) != 0 || len(result.Refused) != 0 {
		t.Fatalf("valid binding changed: %+v", result)
	}
}

func TestCollectionExtractorDeclaredCustomMatcher(t *testing.T) {
	source := `declare global {
  interface MapConstructor {
   [customMatcher](subject: unknown, hint: { matchType: "boolean" | "extractor" }): readonly [string]
  }
 }
 export function read(s: Map<string, number>): string {
  return match(s) { when Map(let m): m; default: "fallback"; }
 }`
	if ds := errorsOf(t, source); len(ds) != 0 {
		t.Fatalf("declared own matcher lost: %v", ds)
	}
}
