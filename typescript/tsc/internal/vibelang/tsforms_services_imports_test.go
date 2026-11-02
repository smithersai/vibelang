package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// In a project that emits declarations, EK4831's fix keeps the import of
// Context that the declaration file writes a service's base through (D501),
// even where the Context.Service class was its only use, so the file's .d.ts
// stays what it was (Smithers' flows/secrets Egress, two services). Without
// declarations nothing reads the import, so it goes, as does Effect once the
// contracts are written A!E. A named import from effect's root is the
// spelling the declaration file writes for the prelude's names anyway, so
// --fix removes it and the .d.ts keeps the same import.
func TestFixServiceClassImports(t *testing.T) {
	source := "import * as Context from \"effect/Context\"\nimport * as Effect from \"effect/Effect\"\n\nexport class Vault extends Context.Service<Vault, {\n  readonly get: (name: string) => Effect.Effect<string>\n}>()(\"@smithers/secrets/Vault\") {}\n\nexport const name = (n: string): Effect.Effect<string> => Effect.succeed(n)\n"
	named := "import { Context, Effect } from \"effect\"\n\nexport class Vault extends Context.Service<Vault, {\n  readonly get: (name: string) => Effect.Effect<string>\n}>()(\"@smithers/secrets/Vault\") {}\n\nexport const name = (n: string): Effect.Effect<string> => Effect.succeed(n)\n"
	service := "export service Vault {\n  static readonly key = \"@smithers/secrets/Vault\"\n  get: (name: string) => string!!\n}\n\nexport const name = (n: string): string!! => n\n"
	for _, tc := range []struct {
		name, source, options, want string
	}{
		{"kept", source, `"declaration":true,"noEmit":true`, "import * as Context from \"effect/Context\"\nimport * as Effect from \"effect/Effect\"\n\n" + service},
		{"removed without declarations", source, `"noEmit":true`, "\n" + service},
		{"named import", named, `"declaration":true,"noEmit":true`, "\n" + service},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],`+tc.options+`}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			fixed := FixProject(t.Context(), fs, bundled.LibPath(), config).Files[file.FileName()]
			got := ""
			if fixed != nil {
				got = fixed.Text
			}
			if got != tc.want {
				t.Fatalf("--fix wrote\n%s\nwant\n%s", got, tc.want)
			}
		})
	}
}
