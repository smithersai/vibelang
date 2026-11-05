package vibelang

import (
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

// VIP-13's cross-copy matcher must survive the behavior-preserving class repair.
func TestErrorMemberClassFixKeepsMatcher(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal("node is required to check the migration's runtime matcher")
	}
	for _, prefix := range []string{"", "const Data = 0; const TaggedError = 1; const $ErrorTaggedError = 2; const $ErrorMatcher = 3; const $ErrorMatcher2 = 4;\n"} {
		for _, member := range []string{
			"static meta = 3",
			"static meta(): number { return 3 }",
			"static get meta() { return 3 }",
			"static set meta(value: number) {}",
		} {
			t.Run(prefix+member, func(t *testing.T) {
				fixed := applyQuickFixOf(t, prefix+"export error E { id: string; "+member+" }\n", 1302, diagnostics.CategoryError)
				fixed += "\nexport function matchesCopy(value: unknown) { return match(value) { when E: true; default: false; } }\n"
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
				script := `import { E, matchesCopy } from "./out/main.js";
const subject = { _tag: "E", id: "copy" };
const key = Symbol.customMatcher ?? Symbol.for("Symbol.customMatcher");
if (!Object.hasOwn(E, key)) throw new Error("class repair lost its own matcher");
const matcher = E[key];
for (const matchType of ["boolean", "extractor"]) {
 const result = matcher(subject, { matchType });
 if (!Array.isArray(result) || result.length !== 1 || result[0] !== subject) throw new Error("saved matcher lost its subject");
}
if (!matchesCopy(subject)) throw new Error("class repair lost class-pattern tag matching");
if (typeof matcher !== "function" || matcher.call(E, subject, { matchType: "extractor" })?.[0] !== subject) {
  throw new Error("class repair lost its cross-copy matcher");
}
const value = new E({ id: "own" });
if (value.id !== "own" || value._tag !== "E") throw new Error("class repair changed construction");
`
				cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "-e", script)
				cmd.Dir = dir
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("class repair runtime: %v\n%s\n%s", err, output, fixed)
				}
			})
		}
	}
}
