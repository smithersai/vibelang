package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const effectPinRootsQuote = "This is one project-level diagnostic on the configuration file or package manifest, independent of the number of files and use sites."

func TestEffectPinRootsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), effectPinRootsQuote) {
		t.Fatal(effectPinRootsQuote)
	}
}

// The project pin diagnostic must not depend on its filesystem root or on
// adding sources. Mutations vary directory depth, manifest location, source
// extension, case sensitivity and whether Effect resolves to the pinned version.
func FuzzEffectPinRoots(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"drive", "untitled", "posix"} {
		for _, variant := range []uint16{0, 1, 7, 8, 15, 16, 24, 32, 64, 127, 128, 255, 256, 319, 575, 1024} {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint16) {
		TestEffectPinRootsQuoted(t)
		root := map[string]string{"drive": "c:/", "untitled": "^/", "posix": "/"}[key]
		if root == "" {
			key, root = "drive", "c:/"
		}
		defer func() {
			if err := recover(); err != nil {
				Gap(t, "FuzzEffectPinRoots", key+":panic", "project pin lookup panicked: %v", err)
			}
		}()
		depth := int(variant & 7)
		dir := root + strings.Repeat("project/", depth)
		ext := ".vibe"
		if variant&8 != 0 {
			ext = ".vibex"
		}
		cs := tspath.CaseSensitive
		if variant&16 != 0 {
			cs = tspath.CaseInsensitive
		}
		files := map[string]string{}
		var names []tspath.RootedFilePath
		for i := 0; i < 1+int(variant>>8)%3; i++ {
			name := fmt.Sprintf("%sfile%d%s", dir, i, ext)
			files[name] = "export const value = 1"
			names = append(names, tspath.RootedFilePathFromAbsolute(name))
		}
		anchor := ""
		if variant&32 != 0 {
			anchor = root + "package.json"
			files[anchor] = `{"name":"root-package"}`
		}
		if variant&64 != 0 {
			anchor = dir + "package.json"
			files[anchor] = `{"name":"nearest-package"}`
		}
		version := "4.0.3"
		if variant&128 != 0 {
			version = PinnedEffectVersion()
		}
		// Dependency manifests are never the project's diagnostic anchor.
		if variant&1024 == 0 {
			files[root+"node_modules/effect/package.json"] = fmt.Sprintf(`{"name":"effect","version":%q,"types":"index.d.ts"}`, version)
			files[root+"node_modules/effect/index.d.ts"] = "export declare const value: number"
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, cs))
		config := tsoptions.NewParsedCommandLine(&core.CompilerOptions{
			NoLib: core.TSTrue, NoEmit: core.TSTrue, Module: core.ModuleKindNodeNext,
		}, names, nil, names[0].Directory(), cs)
		p := compiler.NewProgram(compiler.ProgramOptions{
			Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil),
			SingleThreaded: core.TSTrue,
		})
		count := 0
		for _, d := range p.GetProgramDiagnostics() {
			if d.Source() != "EK" || d.Code() != 3201 {
				continue
			}
			count++
			got := ""
			if d.File() != nil {
				got = d.File().FileName().AsString()
			}
			if got != anchor {
				Gap(t, "FuzzEffectPinRoots", key+":anchor", "%s: manifest %q, want %q", effectPinRootsQuote, got, anchor)
			}
		}
		want := 1
		if version == PinnedEffectVersion() || variant&1024 != 0 {
			want = 0
		}
		if count != want {
			Gap(t, "FuzzEffectPinRoots", key+":count", "%s: got %d diagnostics, want %d", effectPinRootsQuote, count, want)
		}
	})
}
