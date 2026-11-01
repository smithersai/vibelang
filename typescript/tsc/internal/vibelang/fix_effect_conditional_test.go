package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Smithers flows/sync ProtocolVersion (drive-smithers run4d, TS2322
// "Effect<void, never, never> is not assignable to void", 14 modules): an
// arrow with an Effect contract returns a conditional of programs. Once the
// effect mark alone decides (VIP-1), the unmarked arrow is plain and returns
// the chosen program, which its contract types and its callers run: the
// program the old Effect form ran (decided detail 274 keeps that run phase).
// --fix-vip-only leaves it as written and refuses nothing, and it compiles.
func TestFixVIPConditionalReturnedPrograms(t *testing.T) {
	for _, test := range []struct{ name, body string }{
		{"void or fail", "version === 1\n    ? Effect.void\n    : Effect.fail(new Mismatch({ version }))"},
		{"held or fail", "version === 1 ? (held) : Effect.fail(new Mismatch({ version }))"},
		{"nested", "version === 1 ? Effect.void : version === 2 ? held : Effect.fail(new Mismatch({ version }))"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import * as Effect from \"effect/Effect\"\n\nclass Mismatch extends TaggedError(\"Mismatch\")<{ readonly version: number | undefined }> {}\n\nconst held: Effect.Effect<void> = Effect.void\n\nexport const requireVersion = (version: number | undefined): Effect.Effect<void, Mismatch> =>\n  " + test.body + "\n"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
			if len(result.Files) != 0 || len(result.Refused) != 0 {
				t.Fatalf("--fix-vip-only wrote %d files and refused %+v", len(result.Files), result.Refused)
			}
			program, sourceFile, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), sourceFile) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the program reports %d: %s", d.Code(), d.MessageText())
				}
			}
		})
	}
}
