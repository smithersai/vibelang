package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A type synthesized by Effect.fn's fix used to import a body's generated
// declaration, giving the check program its own output as an input (TS5055).
// Preserve the written type and its source identity across repeated builds/fixes.
func TestFixGeneratedSidecarInputs(t *testing.T) {
	for _, layout := range []string{"", ".vibe/declarations"} {
		for _, annotation := range []string{"ReturnType<typeof make>", "Parameters<typeof accept>[0]"} {
			for _, parameter := range []string{"value: %s", "value?: %s", "value: %s = make()", "...value: %s[]", "...value: ReadonlyArray<%s>"} {
				t.Run(fmt.Sprintf("%s/%s/%s", layout, annotation, parameter), func(t *testing.T) {
					source := "import { make, accept } from \"./media.vibe\"\nexport const work = Effect.fn(function* (" + fmt.Sprintf(parameter, annotation) + ") { return value })\n"
					// The default must be the annotated type for the object-shaped variant.
					if strings.Contains(parameter, "= make()") && strings.HasPrefix(annotation, "Parameters") {
						source = strings.ReplaceAll(source, "= make()", "= { asset: make() }")
					}
					_, file, _, _ := editorProgram(t, source)
					dir := filepath.Dir(file.FileName().AsString())
					write := func(name, text string) {
						t.Helper()
						if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(name, []byte(text), 0600); err != nil {
							t.Fatal(err)
						}
					}
					write(filepath.Join(dir, "media.vibe"), "module throwing { export class Asset { #value = 1; get value() { return this.#value } }\n/** @throws {never} */ export function make() { return new Asset() }\nexport function accept(value: {asset: Asset}) { return value } }\nexport { make, accept } from throwing\n")
					write(filepath.Join(dir, "tsconfig.json"), fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"rootDir":".","rootDirs":[".",".vibe/declarations"]},"vibe":{"sidecarDir":%q},"include":["*.vibe","*.ts"]}`, layout))
					fs := bundled.WrapFS(osvfs.FS())
					build := func() *compiler.Program {
						t.Helper()
						config, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
						if len(ds) != 0 {
							t.Fatal(ds)
						}
						p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
						for _, d := range p.GetProgramDiagnostics() {
							if d.Code() == 5055 {
								t.Fatal(d.String())
							}
						}
						r := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { write(name, text); return nil })
						if r.EmitSkipped {
							t.Fatal("sidecar emit skipped", r.Diagnostics)
						}
						return p
					}
					build()
					p := build()
					for repeat := range 2 {
						result := FixProject(t.Context(), fs, bundled.LibPath(), p.CommandLine())
						if result.Err != nil || len(result.Refused) != 0 {
							t.Fatalf("repeat %d: err %v refused %+v", repeat, result.Err, result.Refused)
						}
						for name, f := range result.Files {
							write(name.AsString(), f.Text)
						}
						got, err := os.ReadFile(file.FileName().AsString())
						if err != nil {
							t.Fatal(err)
						}
						if strings.Contains(string(got), "Effect.fn") || !strings.Contains(string(got), annotation) {
							t.Fatalf("lost written type or kept generator:\n%s", got)
						}
						if repeat == 1 && len(result.Order) != 0 {
							t.Fatalf("second fix edited %v", result.Order)
						}
						p = build()
						for _, d := range programErrors(t.Context(), p) {
							t.Errorf("fixed program: %s", d.String())
						}
					}
				})
			}
		}
	}
}

func TestEffectFnTypeHasImport(t *testing.T) {
	for text, want := range map[string]bool{
		`import("./media.vibe.throwing.js").Asset`: true,
		`{ asset: import("./media.vibe").Asset }`:  true,
		`typeof import("./media.vibe")`:            true,
		`"import('./media')"`:                      false,
		`{ import(): number }`:                     false,
		`ReturnType<typeof make>`:                  false,
	} {
		if got := effectFnTypeHasImport(text); got != want {
			t.Errorf("%s: %t, want %t", text, got, want)
		}
	}
}
