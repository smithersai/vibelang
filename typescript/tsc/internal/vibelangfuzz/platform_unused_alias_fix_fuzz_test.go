package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const unusedAliasFixQuote = "In every scope, `--fix` removes an import only when the resulting declaration preserves"

func unusedAliasFixQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("007-tooling.md"), unusedAliasFixQuote) {
		t.Fatal(unusedAliasFixQuote)
	}
}
func TestUnusedPlatformAliasFixQuoted(t *testing.T) { unusedAliasFixQuoted(t) }

func FuzzUnusedPlatformAliasFix(f *testing.F) {
	startShortBudget(f)
	unusedAliasFixQuoted(f)
	keys := []string{"erased", "globalThis-erased", "used", "type", "reexport", "exported", "script", "comment", "escaped"}
	for _, key := range keys {
		f.Add([]byte(key + "\x00\x00"))
		f.Add([]byte(key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		unusedAliasFixQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			key = keys[len(data)%len(keys)]
		}
		verbatim := len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0
		source := "import NativeModule = WebAssembly.Module\nexport const value = 1\n"
		switch key {
		case "globalThis-erased":
			source = "import NativeModule = globalThis.WebAssembly.Module\nexport const value = 1\n"
		case "used":
			source = "import NativeModule = WebAssembly.Module\nexport const value = NativeModule\n"
		case "type":
			source = "import NativeModule = WebAssembly.Module\nexport type Value = typeof NativeModule\n"
		case "reexport":
			source = "import NativeModule = WebAssembly.Module\nexport {NativeModule}\n"
		case "exported":
			source = "export import NativeModule = WebAssembly.Module\nexport const value = 1\n"
		case "script":
			source = "import NativeModule = WebAssembly.Module\nconst value = 1\n"
		case "comment":
			source = "// preserve comment\n" + source
		case "escaped":
			source = "import NativeModule = WebAssembly.Module\nexport type Value = typeof Native\\u004dodule\n"
		}
		configText := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","skipLibCheck":true,"moduleDetection":"legacy","noEmit":true,"types":[],"verbatimModuleSyntax":%t},"files":["main.vibe"]}`, verbatim)
		files := map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}
		before, err := w.Compile(t.Context(), Project{Config: configText, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		want := source
		if (key == "erased" || key == "globalThis-erased") && !verbatim {
			want = "export const value = 1\n"
		}
		if fixed["main.vibe"] != want {
			Gap(t, "FuzzUnusedPlatformAliasFix", key, "VIP34 import preservation: got %q, want %q", fixed["main.vibe"], want)
			return
		}
		after, err := w.Compile(t.Context(), Project{Config: configText, Files: fixed})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil {
			t.Fatal(again.Err)
		}
		if len(again.Files) != 0 {
			Gap(t, "FuzzUnusedPlatformAliasFix", key, "fix not idempotent: %+v", again.Files)
			return
		}
		if want != source && !toolsErrorFree(after) {
			Gap(t, "FuzzUnusedPlatformAliasFix", key, "fixed output does not compile: %v", after.Diagnostics)
			return
		}
		ExpectPending(t, "FuzzUnusedPlatformAliasFix", key)
		ExpectPending(t, "FuzzUnusedPlatformAliasFix", specCorpusKey(t))
	})
}
