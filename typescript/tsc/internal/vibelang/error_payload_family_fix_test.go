package vibelang

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Either diagnostic can be the editor's selected action. The native class must
// keep family encode/decode when EK1302 is selected beside a reserved payload.
func TestErrorReservedPayloadTagSelectedActionKeepsFamily(t *testing.T) {
	for _, abstract := range []string{"", "abstract "} {
		for _, member := range []string{"static meta = 3", "set label(value: string) {}"} {
			for _, code := range []int32{1302, 2117} {
				t.Run(fmt.Sprintf("%s/%s/%d", abstract, member, code), func(t *testing.T) {
					source := "export " + abstract + "schema error E { _tag: string; id: string; " + member + " }\nexport schema error Child extends E { n: number }\n"
					fixed := applyQuickFixOf(t, source, code, diagnostics.CategoryError)
					_, file, _, _ := editorProgram(t, fixed)
					dir := filepath.Dir(file.FileName().AsString())
					configPath := filepath.Join(dir, "tsconfig.json")
					configText := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out"},"files":["main.vibe"]}`
					if err := os.WriteFile(configPath, []byte(configText), 0o644); err != nil {
						t.Fatal(err)
					}
					fs := bundled.WrapFS(osvfs.FS())
					config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configPath)), &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatal(errors)
					}
					program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
					for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("class repair: %s", d.String())
						}
					}
					result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
						if err := os.MkdirAll(filepath.Dir(name.AsString()), 0o755); err != nil {
							return err
						}
						return os.WriteFile(name.AsString(), []byte(text), 0o644)
					}})
					if result.EmitSkipped {
						t.Fatal("class repair emitted no JavaScript")
					}
					script := `import assert from "node:assert/strict";
import * as Schema from "effect/Schema";
import { E, Child } from "./out/main.js";
const fields = { _tag: "Child", id: "x", n: 7 };
assert.deepEqual(Schema.encodeSync(E)(new Child({ id: "x", n: 7 })), fields);
const decoded = Schema.decodeUnknownSync(E)(fields);
assert.ok(decoded instanceof Child);
assert.equal(decoded.n, 7);
assert.equal(decoded.id, "x");
`
					cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "-e", script)
					cmd.Dir = dir
					if output, err := cmd.CombinedOutput(); err != nil {
						t.Fatalf("family repair runtime: %v\n%s\n%s", err, output, fixed)
					}
				})
			}
		}
	}
}
