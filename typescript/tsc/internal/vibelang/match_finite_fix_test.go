package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFiniteMatchPreservingFix(t *testing.T) {
	for _, modifier := range []string{"", "async ", "effect "} {
		for _, test := range []struct{ name, prefix, parameter, arms string }{
			{"boolean", "", "boolean", "when true:1;"},
			{"tagged", `type T={_tag:"A"}|{_tag:"B"};`, "T", `when {_tag:"A"}:1;`},
			{"nested", "data Leaf { One; Two };data Wrap { Box { value: Leaf } };", "Wrap", `when {_tag:"Box",value:{_tag:"One"}}:1;`},
		} {
			t.Run(modifier+test.name, func(t *testing.T) {
				source := test.prefix + "export " + modifier + "function choose(value:" + test.parameter + "){const TypeError=0;const Effect=0;return match(value){" + test.arms + "}}"
				before := finiteMatchFixDeclarations(t, source, 1)
				for _, options := range []FixOptions{{}, {MigrationOnly: true}} {
					program, file, _, _ := editorProgram(t, source)
					result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
					fixed := result.Files[file.FileName()]
					if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[4701] != 1 {
						t.Fatalf("ordinary finite coverage repair: options=%+v result=%+v fixed=%+v", options, result, fixed)
					}
					if got := finiteMatchFixDeclarations(t, fixed.Text, 0); got != before {
						t.Fatalf("repair changed the declaration:\n%s\nwant:\n%s", got, before)
					}
					if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0o600); err != nil {
						t.Fatal(err)
					}
					again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), options)
					if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
						t.Fatalf("repair is not idempotent: %+v", again)
					}
				}
			})
		}
	}
}

// Force the before declaration through the expected coverage error only.
// Every other error remains a failure, and the repaired source permits none.
func finiteMatchFixDeclarations(t *testing.T, source string, wantMissing int) string {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	missing := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() != 4701 {
			t.Fatal(d.String())
		}
		missing++
	}
	if missing != wantMissing {
		t.Fatalf("got %d missing-case diagnostics, want %d\n%s", missing, wantMissing, source)
	}
	declaration := ""
	program.Emit(t.Context(), compiler.EmitOptions{ForceEmit: true, EmitOnly: compiler.EmitOnlyDts, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "/main.d.ts") {
			declaration = text
		}
		return nil
	}})
	if declaration == "" {
		t.Fatal("no declaration output")
	}
	return declaration
}
