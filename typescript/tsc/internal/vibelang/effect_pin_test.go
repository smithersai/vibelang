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

func TestIsSupportedEffectVersion(t *testing.T) {
	accepted := []string{"4.1.0", "4.1.1", "4.1.4", "4.1.6", "4.2.0", "4.12.9"}
	for _, v := range accepted {
		if !isSupportedEffectVersion(v) {
			t.Errorf("isSupportedEffectVersion(%q) = false, want true", v)
		}
	}
	rejected := []string{
		"", "3.19.0", "3.99.0", "4.0.0", "4.0.3", "4.0.6",
		"5.0.0", "5.1.0", "4.1.0-next.1", "4.1.1-next.1", "4.1.6-next.1",
		"4.2.0-beta.0", "4.1.6+build.1", "4.1", "04.1.0", "4.1.0.0", "latest",
	}
	for _, v := range rejected {
		if isSupportedEffectVersion(v) {
			t.Errorf("isSupportedEffectVersion(%q) = true, want false", v)
		}
	}
}

// VIP-32 (amended): a resolved effect outside stable ^4.1.0 (>=4.1.0 <5.0.0,
// no prereleases) reports EK3201 once on the project config, naming the
// resolved version, VibeLang version, supported range, and tested baseline.
func TestEffectPinMismatch(t *testing.T) {
	for _, test := range []struct {
		name, fixture, version string
	}{
		{"older major 3.x", "testdata/effect-pin/effect-3.19.0", "3.19.0"},
		{"older minor 4.0.x", "testdata/effect-pin/effect-4.0.3", "4.0.3"},
		{"next major 5.x", "testdata/effect-pin/effect-5.0.0", "5.0.0"},
		{"prerelease 4.1.1-next.1", "testdata/effect-pin/effect-4.1.1-next.1", "4.1.1-next.1"},
		{"prerelease 4.1.6-next.1", "testdata/effect-pin/effect-4.1.6-next.1", "4.1.6-next.1"},
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
				want := fmt.Sprintf("The resolved effect is %s; VibeLang %s requires %s (tested on %s): upgrade both together.", test.version, Version, supportedEffectRange, supportedEffectVersion)
				if text != want {
					t.Fatalf("%q: EK3201 text %q, want %q", source, text, want)
				}
				for _, part := range []string{test.version, Version, supportedEffectRange, supportedEffectVersion, "upgrade both together"} {
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

// Any stable effect in ^4.1.0 (>=4.1.0 <5.0.0), a package without a version,
// and no effect at all report no EK3201.
func TestEffectPinQuiet(t *testing.T) {
	for _, test := range []struct {
		name     string
		packages map[string]string
	}{
		{"tested baseline", map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"}},
		{"4.1.0", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0"}},
		{"4.1.2", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.2"}},
		{"4.1.4", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.4"}},
		{"4.2.0", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.2.0"}},
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

// Every selected package must resolve a supported Effect version, independently of source order.
func TestEffectPinMismatchAfterPinnedFile(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(fmt.Sprintf("reverse=%v", reverse), func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, "export const n: number = 1", map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"})
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
				t.Fatalf("off-range diagnostic belongs to the other package: %v", pins[0])
			}
		})
	}
}

// Adding source files or querying them in a different order cannot multiply
// a project dependency error, including with multiple compiler checkers.
func TestEffectPinFileCountProperty(t *testing.T) {
	property := func(raw uint8, reverse bool) bool {
		count := 1 + int(raw%24)
		_, file, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.0.3"})
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

// Every platform peer outside ^4.1.0 has its own single project diagnostic,
// while any stable platform peer in ^4.1.0 (e.g. 4.1.1, 4.1.6, 4.2.0) passes.
func TestEffectPlatformPinMismatch(t *testing.T) {
	for _, tc := range []struct {
		version string
		want    int
	}{
		{"4.0.3", 5},
		{"4.1.4", 1},
		{supportedEffectVersion, 1},
	} {
		t.Run(tc.version, func(t *testing.T) {
			_, file, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.0.3"})
			dir := filepath.Dir(file.FileName().AsString())
			for _, name := range []string{"platform-node", "platform-bun", "platform-browser", "platform-node-shared"} {
				pkg := filepath.Join(dir, "node_modules/@effect", name)
				if err := os.MkdirAll(pkg, 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(pkg, "package.json"), []byte(fmt.Sprintf(`{"name":"@effect/%s","version":"%s","types":"index.d.ts"}`, name, tc.version)), 0600); err != nil {
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
			if len(pins) != tc.want {
				t.Fatalf("want %d project pins, got %v", tc.want, pins)
			}
			for _, d := range pins {
				if d.File() == nil || !strings.HasSuffix(d.File().FileName().AsString(), "/tsconfig.json") || !strings.Contains(d.MessageText(), "4.0.3") || !strings.Contains(d.MessageText(), supportedEffectRange) || !strings.Contains(d.MessageText(), supportedEffectVersion) {
					t.Fatal(d)
				}
			}
		})
	}
}

func TestEffectPinCommandLineProject(t *testing.T) {
	original, _, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.0.3"})
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
	program, _, _, _ := editorProgramWith(t, "export const n = 1", map[string]string{"effect": "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.0.3"})
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
