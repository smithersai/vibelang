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

func fixUnusedPlatformAlias(t *testing.T, source string, verbatim bool) string {
	t.Helper()
	dir := t.TempDir()
	option := "false"
	if verbatim {
		option = "true"
	}
	for name, text := range map[string]string{
		"package.json":  `{"type":"module"}`,
		"tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"moduleDetection":"legacy","noEmit":true,"types":[],"verbatimModuleSyntax":` + option + `},"files":["main.vibe"]}`,
		"main.vibe":     source,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	result := FixProject(t.Context(), fs, bundled.LibPath(), config)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	for name, file := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			return file.Text
		}
	}
	return source
}

func TestUnusedPlatformAliasFix(t *testing.T) {
	before := "import NativeModule = WebAssembly.Module\nexport const value = 1\n"
	after := "export const value = 1\n"
	for _, test := range []struct {
		name, source string
		verbatim     bool
		want         string
	}{
		{"erased", before, false, after},
		{"qualified globalThis", "import NativeModule = globalThis.WebAssembly.Module\nexport const value = 1\n", false, after},
		{"semicolon", "import NativeModule = WebAssembly.Module;\nexport const value = 1\n", false, after},
		{"verbatim", before, true, before},
		{"value", "import NativeModule = WebAssembly.Module\nexport const value = NativeModule\n", false, ""},
		{"type", "import NativeModule = WebAssembly.Module\nexport type Value = typeof NativeModule\n", false, ""},
		{"reexport", "import NativeModule = WebAssembly.Module\nexport { NativeModule }\n", false, ""},
		{"exported", "export import NativeModule = WebAssembly.Module\nexport const value = 1\n", false, ""},
		{"script", "import NativeModule = WebAssembly.Module\nconst value = 1\n", false, ""},
		{"comment", "// keep this comment\n" + before, false, ""},
		{"escaped-use", "import NativeModule = WebAssembly.Module\nexport type Value = typeof Native\\u004dodule\n", false, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			want := test.want
			if want == "" {
				want = test.source
			}
			got := fixUnusedPlatformAlias(t, test.source, test.verbatim)
			if got != want {
				t.Fatalf("got %q, want %q", got, want)
			}
			if again := fixUnusedPlatformAlias(t, got, test.verbatim); again != got {
				t.Fatalf("not idempotent: %q -> %q", got, again)
			}
		})
	}
}
