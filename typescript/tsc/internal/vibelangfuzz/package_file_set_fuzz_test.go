package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const packageFileSetQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
const packageManifestQuote = "What an import may throw now travels in its declaration file, the same for VibeLang and hand-written TypeScript."

func TestPackageFileSetQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{"001-functions.md": packageFileSetQuote, "../vips/0036-manifest-open.md": packageManifestQuote} {
		data, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), quote) {
			t.Fatalf("%s no longer contains %q", chapter, quote)
		}
	}
}

// VIP-27 permits compatibility sidecars; VIP-36 is open and explicitly
// excludes a declaration manifest from the first release. Everything else
// in a package output follows the ordinary TypeScript twin.
func FuzzPackageFileSet(f *testing.F) {
	startShortBudget(f)
	tsc := StockTypeScript(f)
	modes := []string{"declarations", "declaration-only", "declaration-dir", "maps", "javascript"}
	for _, mode := range modes {
		f.Add(mode, uint8(2), int16(7))
	}
	f.Fuzz(func(t *testing.T, key string, width uint8, value int16) {
		mode := slices.Index(modes, key)
		if mode < 0 {
			mode = 0
			for _, b := range []byte(key) {
				mode = (mode + int(b)) % len(modes)
			}
		}
		key = modes[mode]
		count := 1 + int(width%3)
		options := `"target":"es2022","module":"nodenext","moduleResolution":"nodenext","types":[],"outDir":"out"`
		if key != "javascript" {
			options += `,"declaration":true`
		}
		switch key {
		case "declaration-only":
			options += `,"emitDeclarationOnly":true`
		case "declaration-dir":
			options += `,"declarationDir":"types"`
		case "maps":
			options += `,"sourceMap":true,"declarationMap":true`
		}
		config := `{"compilerOptions":{` + options + `},"include":["*.ts"]}`
		dir := t.TempDir()
		files := map[string]any{"/pkg/tsconfig.json": strings.ReplaceAll(config, `*.ts`, `*.vibe`)}
		for i := 0; i < count; i++ {
			text := fmt.Sprintf("export function value%d(n: number): number { return n + (%d) }\n", i, value)
			files[fmt.Sprintf("/pkg/unit%d.vibe", i)] = text
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("unit%d.ts", i)), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
			t.Fatal(err)
		}
		cmd := exec.CommandContext(t.Context(), tsc, "-p", dir, "--pretty", "false")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("stock twin: %v\n%s", err, out)
		}
		var stock []string
		if err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				rel, _ := filepath.Rel(dir, path)
				if strings.HasPrefix(rel, "out/") || strings.HasPrefix(rel, "types/") {
					stock = append(stock, filepath.ToSlash(rel))
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile("/pkg/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errs) != 0 {
			t.Fatal(errs)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		var mu sync.Mutex
		var got []string
		result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, _ string, _ *compiler.WriteFileData) error {
			mu.Lock()
			defer mu.Unlock()
			got = append(got, strings.TrimPrefix(name.AsString(), "/pkg/"))
			return nil
		}})
		if len(result.Diagnostics) != 0 {
			t.Fatal(result.Diagnostics)
		}
		slices.Sort(got)
		slices.Sort(stock)
		if !slices.Equal(got, stock) {
			Gap(t, "FuzzPackageFileSet", key, "VIP-27/VIP-36: package emitted %v; stock TypeScript emitted %v", got, stock)
		}
		var sidecars []string
		p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
			mu.Lock()
			defer mu.Unlock()
			sidecars = append(sidecars, name)
			return nil
		})
		var expected []string
		for i := 0; i < count; i++ {
			expected = append(expected, fmt.Sprintf("/pkg/unit%d.d.vibe.ts", i), fmt.Sprintf("/pkg/unit%d.d.ts", i))
		}
		slices.Sort(sidecars)
		slices.Sort(expected)
		if !slices.Equal(sidecars, expected) {
			Gap(t, "FuzzPackageFileSet", key, "unexpected declaration outputs: got %v, want %v", sidecars, expected)
		}
	})
}
