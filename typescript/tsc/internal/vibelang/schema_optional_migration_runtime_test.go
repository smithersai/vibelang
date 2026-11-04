package vibelang

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 7's compatibility upgrade preserves decoding, constructors and VIP-13
// cross-copy matching as well as the declaration codec checked separately.
func TestSchemaOptionalMigrationRuntime(t *testing.T) {
	for _, row := range []struct{ name, prefix, body string }{
		{"ordinary", "", "export schema error E { status?: number; get label() { return \"kept\" } }"},
		{"directive", "\"use client\";\n", "export schema error E { status?: number; get label() { return \"kept\" } }"},
		{"inline-doc", "", "export schema error E { /** status docs */ status?: number; get label() { return \"kept\" } }"},
		{"attached-doc", "", "export schema error E {\n /** status docs */\n status?: number; get label() { return \"kept\" } }"},
		{"prelude", "", "export schema error E { status?: number; get label() { return \"kept\" } }"},
		{"named-import", "", "export schema error E { status?: number; get label() { return \"kept\" } }"},
		{"family", "", "export schema error Parent { status?: number; get label() { return \"kept\" } }\nexport schema error E { status?: number; get label() { return \"kept\" } }\nexport type Family = Parent | E"},
	} {
		t.Run(row.name, func(t *testing.T) {
			prefix := row.prefix
			imports := "import * as Schema from \"effect/Schema\"\n"
			if row.name == "prelude" {
				imports = ""
			}
			if row.name == "named-import" {
				imports = "import { Schema } from \"effect\"\n"
			}
			source := prefix + imports + row.body + "\n"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			fs := bundled.WrapFS(osvfs.FS())
			configure := func(exact bool, out string) *tsoptions.ParsedCommandLine {
				configPath := filepath.Join(dir, "tsconfig.json")
				configText := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"exactOptionalPropertyTypes":%t,"skipLibCheck":true,"declaration":true,"outDir":%q},"files":["main.vibe"]}`, exact, out)
				if err := os.WriteFile(configPath, []byte(configText), 0600); err != nil {
					t.Fatal(err)
				}
				config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
				if len(errors) != 0 || len(config.Errors) != 0 {
					t.Fatalf("config: %v %v", errors, config.Errors)
				}
				return config
			}
			emit := func(config *tsoptions.ParsedCommandLine) {
				program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
				for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("runtime input: %s", d.String())
					}
				}
				result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
					if err := os.MkdirAll(filepath.Dir(name.AsString()), 0755); err != nil {
						return err
					}
					return os.WriteFile(name.AsString(), []byte(text), 0644)
				}})
				if result.EmitSkipped {
					t.Fatal("runtime input emitted no JavaScript")
				}
			}
			emit(configure(false, "before"))
			config := configure(true, "after")
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{MigrationOnly: true})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("migration: %+v", result)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil {
				t.Fatal("missing optional compatibility upgrade")
			}
			if prefix != "" && !strings.HasPrefix(fixed.Text, prefix) {
				t.Fatalf("directive displaced: %s", fixed.Text)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			emit(config)
			beforeDeclaration, err := os.ReadFile(filepath.Join(dir, "before", "main.d.ts"))
			if err != nil {
				t.Fatal(err)
			}
			afterDeclaration, err := os.ReadFile(filepath.Join(dir, "after", "main.d.ts"))
			if err != nil {
				t.Fatal(err)
			}
			if string(beforeDeclaration) != string(afterDeclaration) {
				t.Fatalf("legacy declaration changed:\nbefore:\n%s\nafter:\n%s\nfixed:\n%s", beforeDeclaration, afterDeclaration, fixed.Text)
			}
			script := `import * as Schema from "effect/Schema";
import { E as Before } from "./before/main.js";
import { E as After } from "./after/main.js";
const observe = E => {
 const accepts = value => { try { Schema.decodeUnknownSync(E)(value); return true; } catch { return false; } };
 const subject = { _tag: "E", status: 1 };
 const matcher = E[Symbol.customMatcher ?? Symbol.for("Symbol.customMatcher")];
 const matches = value => matcher.call(E, value, { matchType: "extractor" })?.[0] === value;
 return [accepts({_tag:"E"}),accepts({_tag:"E",status:undefined}),accepts({_tag:"E",status:null}),
 new E({status:1}).label,matches(subject),matches({_tag:"Other",status:1})];
};
const expected=[true,true,false,"kept",true,false];
for (const E of [Before,After]) {
 const result=observe(E);
 if (JSON.stringify(result)!==JSON.stringify(expected)) throw new Error(JSON.stringify(result));
}
`
			cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "-e", script)
			cmd.Dir = dir
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("optional migration runtime: %v\n%s\n%s", err, output, fixed.Text)
			}
		})
	}
}
