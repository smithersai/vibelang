package vibelang

import (
	"os"
	"path/filepath"
	"strings"
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
// arrow with an Effect contract returns a conditional of programs.
// --fix-vip-only marks it effect and runs each arm the conditional returns,
// so it keeps its meaning and compiles: an arm that is a program gets try,
// and an arm that is a call gets its try where it stands. (Plain --fix does
// not mark functions; the VIP-1 flip makes the unmarked arrow plain, which
// returns the program as TypeScript does.)
func TestFixVIPConditionalReturnedPrograms(t *testing.T) {
	for _, test := range []struct{ name, body, want string }{
		{"void or fail", "version === 1\n    ? Effect.void\n    : Effect.fail(new Mismatch({ version }))", "try Effect.void"},
		{"held or fail", "version === 1 ? (held) : Effect.fail(new Mismatch({ version }))", "try (held)"},
		{"nested", "version === 1 ? Effect.void : version === 2 ? held : Effect.fail(new Mismatch({ version }))", "version === 2 ? try held"},
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
			for _, options := range []FixOptions{{VIPOnly: true}} {
				result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, options)
				fixed := result.Files[file.FileName()]
				if fixed == nil {
					t.Fatalf("%+v: --fix wrote nothing; refused %+v", options, result.Refused)
				}
				if !strings.Contains(fixed.Text, test.want) {
					t.Errorf("%+v: --fix wrote\n%s\nwant it to contain %q", options, fixed.Text, test.want)
				}
				// The fixed program compiles.
				program, fixedFile, _, _ := editorProgram(t, fixed.Text)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), fixedFile) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("%+v: the fixed program reports %d: %s\n%s", options, d.Code(), d.MessageText(), fixed.Text)
					}
				}
			}
		})
	}
}
