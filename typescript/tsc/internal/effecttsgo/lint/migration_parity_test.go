package lint

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-38: apart from EK3012, the explicit default entry preserves inclusion,
// categories, exit judgment and emitted bytes. No ignore flag may be added.
func TestImportedLintMigrationParity(t *testing.T) {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		for _, inherited := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/inherited=%t", severity, inherited), func(t *testing.T) {
				dir := t.TempDir()
				if err := os.MkdirAll(filepath.Join(dir, "node_modules"), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(effect, filepath.Join(dir, "node_modules/effect")); err != nil {
					t.Fatal(err)
				}
				base := `{"compilerOptions":{"plugins":[{"name":"other","nested":{"preserve":true}}]},"vibe":{"severities":{"EK3897":` + fmt.Sprintf("%q", severity) + `}}}`
				text := `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmitOnError":true},"files":["main.ts"],"extends":"./base.json"}`
				if !inherited {
					text = `{"compilerOptions":{"target":"es2022","module":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmitOnError":true,"plugins":[{"name":"other","nested":{"preserve":true}}]},"files":["main.ts"],"vibe":{"severities":{"EK3897":` + fmt.Sprintf("%q", severity) + `}}}`
				}
				name := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
				for file, body := range map[string]string{"package.json": `{"type":"module"}`, "base.json": base, "tsconfig.json": text, "main.ts": "import { Effect } from \"effect\"; export const value = Effect.succeed(Promise.resolve(1));"} {
					if err := os.WriteFile(filepath.Join(dir, file), []byte(body), 0644); err != nil {
						t.Fatal(err)
					}
				}
				type observation struct {
					diagnostics []string
					affects     []bool
					skipped     bool
					files       map[string]string
				}
				observe := func(wantWarning int) (observation, *tsoptions.ParsedCommandLine) {
					fs := bundled.WrapFS(osvfs.FS())
					config, errors := tsoptions.GetParsedCommandLineOfConfigFile(name, &core.CompilerOptions{}, nil, fs, nil)
					if len(errors) != 0 {
						t.Fatal(errors)
					}
					count := 0
					for _, d := range config.GetConfigFileParsingDiagnostics() {
						if d.Code() == 3012 {
							count++
						} else if d.Category().Name() == "error" {
							t.Fatal(d.String())
						}
					}
					if count != wantWarning {
						t.Fatalf("EK3012=%d want%d", count, wantWarning)
					}
					program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
					ds := program.GetSemanticDiagnostics(t.Context(), nil)
					result := observation{files: map[string]string{}}
					found := false
					for _, d := range ds {
						if d.Code() == 3897 {
							found = true
						}
						result.diagnostics = append(result.diagnostics, fmt.Sprintf("%s:%d:%s:%s", d.Source(), d.Code(), d.Category().Name(), d.MessageText()))
					}
					if found != (severity != "off") {
						t.Fatalf("EK3897 witness=%t severity=%s; diagnostics=%v", found, severity, result.diagnostics)
					}
					slices.Sort(result.diagnostics)
					for _, d := range filterForExitCode(program.Options(), ds) {
						result.affects = append(result.affects, d.AffectsBuild())
					}
					var mu sync.Mutex
					emitted := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(path tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
						mu.Lock()
						defer mu.Unlock()
						result.files[path.AsString()] = text
						return nil
					}})
					result.skipped = emitted.EmitSkipped
					return result, config
				}
				before, config := observe(1)
				fixed, changed := tsoptions.MigrateLintPlugin(name, text, config.EffectivePlugins)
				if !changed {
					t.Fatal("migration refused")
				}
				if err := os.WriteFile(name.AsString(), []byte(fixed), 0644); err != nil {
					t.Fatal(err)
				}
				after, _ := observe(0)
				if !reflect.DeepEqual(before, after) {
					t.Fatalf("migration changed behavior:\nbefore=%+v\nafter=%+v\nconfig=%s", before, after, fixed)
				}
			})
		}
	}
}
