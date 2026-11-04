package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/quick"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// pinDiagnostics returns the EK3201 diagnostics of file and every other code.
func pinDiagnostics(t *testing.T, program *compiler.Program, file *ast.SourceFile) (pins []*ast.Diagnostic, others []int32) {
	t.Helper()
	for _, d := range append(program.GetProgramDiagnostics(), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Code() == EK3201.Code {
			pins = append(pins, d)
		} else {
			others = append(others, d.Code())
		}
	}
	return pins, others
}

// VIP-32, 007 "The Effect version", decided detail 70: a resolved effect other
// than the pin is EK3201, once, naming both versions and the VibeLang release.
// Chapter 007 / resolved mismatched Effect reports one EK3201 naming both versions: docs/design/src/007-tooling.md#4078b3e12cdd2a36
// Chapter 007 / resolved mismatched Effect reports one EK3201 naming both versions: docs/design/src/007-tooling.md#f26e9374b3808522
func TestEffectPinMismatch(t *testing.T) {
	for _, test := range []struct {
		name, fixture, version string
	}{
		{"older minor", "testdata/effect-pin/effect-4.0.3", "4.0.3"},
		{"previous patch", "testdata/effect-pin/effect-4.1.0", "4.1.0"},
		{"newer patch", "testdata/effect-pin/effect-4.1.2", "4.1.2"},
		{"prerelease of the pin", "testdata/effect-pin/effect-4.1.1-next.1", "4.1.1-next.1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			packages := map[string]string{"effect": "typescript/tsc/internal/vibelang/" + test.fixture}
			for _, source := range []string{
				"export const n: number = 1",              // never asks for effect: resolved on demand
				"export effect function f() { return 1 }", // the prelude resolves effect for it
			} {
				program, file, _, _ := editorProgramWith(t, source, packages)
				pins, _ := pinDiagnostics(t, program, file)
				if len(pins) != 1 {
					t.Fatalf("%q: want one EK3201, got %d: %v", source, len(pins), program.GetSemanticDiagnostics(t.Context(), file))
				}
				text := pins[0].MessageText()
				for _, part := range []string{test.version, Version, supportedEffectVersion, "upgrade both together"} {
					if !strings.Contains(text, part) {
						t.Fatalf("%q: EK3201 text %q lacks %q", source, text, part)
					}
				}
				if pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/tsconfig.json") {
					t.Fatalf("%q: EK3201 must point to the project config: %v", source, pins[0])
				}
			}
		})
	}
}

// The pinned version, a package without a version, and no effect at all report
// no EK3201: the first is right, the others are what the missing names say.
func TestEffectPinQuiet(t *testing.T) {
	for _, test := range []struct {
		name     string
		packages map[string]string
	}{
		{"pinned", map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"}},
		{"no version", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-unversioned"}},
		{"no effect", map[string]string{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgramWith(t, "export const n: number = 1", test.packages)
			if pins, _ := pinDiagnostics(t, program, file); len(pins) != 0 {
				t.Fatalf("want no EK3201, got %v", pins[0].MessageText())
			}
		})
	}
}

// Every selected package must use the pin, independently of source order.
func TestEffectPinMismatchAfterPinnedFile(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprint(reverse), func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, "export const n: number = 1", map[string]string{"effect": "packages/runtime/node_modules/effect"})
			dir := filepath.Dir(file.FileName().AsString())
			nested := filepath.Join(dir, "nested")
			if err := os.MkdirAll(filepath.Join(nested, "node_modules"), 0755); err != nil {
				t.Fatal(err)
			}
			fixture, err := filepath.Abs("testdata/effect-pin/effect-4.0.3")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(fixture, filepath.Join(nested, "node_modules/effect")); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(nested, "other.vibe"), []byte("export const n: number = 2"), 0600); err != nil {
				t.Fatal(err)
			}
			names := `["main.vibe","nested/other.vibe"]`
			if reverse {
				names = `["nested/other.vibe","main.vibe"]`
			}
			text := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"files":` + names + "}"
			configName := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			pins, others := pinDiagnostics(t, program, nil)
			if len(pins) != 1 || len(others) != 0 {
				t.Fatalf("want one EK3201 for later package, got pins=%v others=%v", pins, others)
			}
			if pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/tsconfig.json") {
				t.Fatalf("off-pin diagnostic belongs to the other package: %v", pins[0])
			}
		})
	}
}

// Adding source files or querying them in a different order cannot multiply
// a project dependency error, including with multiple compiler checkers.
func TestEffectPinFileCountProperty(t *testing.T) {
	property := func(raw uint8, reverse bool) bool {
		count := 1 + int(raw%24)
		_, file, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0"})
		dir := filepath.Dir(file.FileName().AsString())
		names := []string{"main.vibe"}
		for i := 1; i < count; i++ {
			name := fmt.Sprintf("file%d.vibe", i)
			if err := os.WriteFile(filepath.Join(dir, name), []byte("export const n = 1"), 0600); err != nil {
				t.Fatal(err)
			}
			names = append(names, name)
		}
		if reverse {
			for i, j := 0, len(names)-1; i < j; i, j = i+1, j-1 {
				names[i], names[j] = names[j], names[i]
			}
		}
		text := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","skipLibCheck":true,"noEmit":true,"types":[]},"files":["` + strings.Join(names, `","`) + `"]}`
		configName := filepath.Join(dir, "tsconfig.json")
		if err := os.WriteFile(configName, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		fs := bundled.WrapFS(osvfs.FS())
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		pins, _ := pinDiagnostics(t, program, nil)
		if len(pins) != 1 || pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/tsconfig.json") {
			t.Logf("files=%d reverse=%v: %v", count, reverse, pins)
			return false
		}
		// A project diagnostic is repeatable; individual source requests own none.
		if len(program.GetProgramDiagnostics()) != 1 {
			return false
		}
		for _, source := range program.GetSourceFiles() {
			for _, d := range program.GetSemanticDiagnostics(t.Context(), source) {
				if d.Code() == EK3201.Code {
					return false
				}
			}
		}
		return true
	}
	if err := quick.Check(property, &quick.Config{MaxCount: 32}); err != nil {
		t.Fatal(err)
	}
}

// Every platform peer has its own single project diagnostic. Root and
// subpath imports, and an unused installed peer, cannot change that count.
func TestEffectPlatformPinMismatch(t *testing.T) {
	for _, version := range []string{"4.1.0", supportedEffectVersion} {
		t.Run(version, func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0"})
			dir := filepath.Dir(file.FileName().AsString())
			for _, name := range []string{"platform-node", "platform-bun", "platform-browser", "platform-node-shared"} {
				pkg := filepath.Join(dir, "node_modules/@effect", name)
				if err := os.MkdirAll(pkg, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(pkg, "package.json"), []byte(fmt.Sprintf(`{"name":"@effect/%s","version":"%s","types":"index.d.ts"}`, name, version)), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(pkg, "index.d.ts"), []byte("export declare const value: number"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatal(errors)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			pins, _ := pinDiagnostics(t, program, nil)
			want := 5
			if version == supportedEffectVersion {
				want = 1
			}
			if len(pins) != want {
				t.Fatalf("want %d project pins, got %v", want, pins)
			}
			for _, d := range pins {
				if d.File() == nil || !strings.HasSuffix(d.File().FileName().AsString(), "/tsconfig.json") || !strings.Contains(d.MessageText(), "4.1.0") || !strings.Contains(d.MessageText(), supportedEffectVersion) {
					t.Fatal(d)
				}
			}
		})
	}
}

func TestEffectPinCommandLineProject(t *testing.T) {
	original, _, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0"})
	config := original.CommandLine()
	config.ConfigFile = nil
	config.CompilerOptions().ConfigFilePath = ""
	fs := bundled.WrapFS(osvfs.FS())
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	pins, _ := pinDiagnostics(t, program, nil)
	if len(pins) != 1 || pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/package.json") {
		t.Fatalf("want package manifest anchor: %v", pins)
	}
}

func TestEffectPinConcurrentProjectRequests(t *testing.T) {
	program, _, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0"})
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			pins := program.GetProgramDiagnostics()
			if len(pins) != 1 || pins[0].File() == nil || !strings.HasSuffix(pins[0].File().FileName().AsString(), "/tsconfig.json") {
				t.Errorf("want one stable project pin: %v", pins)
			}
		})
	}
	wg.Wait()
}
