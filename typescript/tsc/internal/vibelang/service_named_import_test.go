package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// foldkit-37 (inbox migrate-foldkit.md): foldkit's TypeScript imports
// Context by name from effect's root for its Context.Service classes. Beside
// the service declaration that replaces one, the declaration file writes the
// service's base through Context (D501), so the import is used: no TS6133
// under noUnusedLocals, as the namespace import * as Context already was.
// Without a service, nothing reads it, and TS6133 stays.
func TestServiceNamedContextImportUsed(t *testing.T) {
	service := "export service Port {\n  static readonly key = \"Port\"\n  read: () => number\n}\n"
	for _, test := range []struct {
		name, source string
		unused       bool
	}{
		{"named", "import { Context } from \"effect\"\n\n" + service, false},
		{"named type-only", "import type { Context } from \"effect\"\n\n" + service, false},
		{"named beside others", "import { Context, Effect } from \"effect\"\n\nexport const one = Effect.succeed(1)\n" + service, false},
		{"namespace", "import * as Context from \"effect/Context\"\n\n" + service, false},
		{"no service", "import { Context } from \"effect\"\n\nexport const one = 1\n", true},
		{"renamed", "import { Context as C } from \"effect\"\n\n" + service, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			dir := filepath.Dir(file.FileName().AsString())
			if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noUnusedLocals":true,"declaration":true,"noEmit":true},"files":["main.vibe"]}`), 0o644); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			main := program.GetSourceFile(file.FileName())
			unused := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), main) {
				if d.Code() == 6133 || d.Code() == 6192 || d.Code() == 6196 {
					unused = true
				}
			}
			if unused != test.unused {
				t.Fatalf("an unused-import report: got %v, want %v", unused, test.unused)
			}
		})
	}
}
