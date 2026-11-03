package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

const crossVariantTarget = "FuzzNativeCrossVariantResolution"
const crossVariantQuote = "Resolution treats `.vibex` as `.vibe`'s `.tsx`"

func TestNativeCrossVariantResolutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), crossVariantQuote) {
		t.Fatalf("VIP-39 no longer says %q", crossVariantQuote)
	}
}
func crossVariantProject(key string, variant uint8, native, stock bool) Project {
	written, physical := "vibe", "vibex"
	if key == "vibex-to-vibe" {
		written, physical = physical, written
	}
	main := "main.vibe"
	if native {
		main = "main.ts"
		written = strings.ReplaceAll(strings.ReplaceAll(written, "vibex", "tsx"), "vibe", "ts")
		physical = strings.ReplaceAll(strings.ReplaceAll(physical, "vibex", "tsx"), "vibe", "ts")
	}
	stem := "sibling"
	if variant&32 != 0 {
		stem = "nested/" + stem
	}
	spec := "./" + stem + "." + written
	var source string
	switch (variant / 4) % 4 {
	case 0:
		source = fmt.Sprintf("import { value } from %q;\nexport const result: 42 = value;\n", spec)
	case 1:
		source = fmt.Sprintf("export { value } from %q;\n", spec)
	case 2:
		source = fmt.Sprintf("import type { Value } from %q;\nexport const proof: Value = 42;\n", spec)
	case 3:
		source = fmt.Sprintf("import type { Value } from %q;\nexport type { Value } from %q;\nexport const proof: Value = 42;\n", spec, spec)
	}
	pkg, _ := json.Marshal(map[string]string{"name": "native-cross-variant", "type": "module"})
	files := map[string]string{main: source, stem + "." + physical: "export const value: 42 = 42; export type Value = 42;\n", "package.json": string(pkg)}
	if variant&16 != 0 {
		files[stem+".d.ts"] = "export declare const value: 0; export type Value = 0;\n"
	}
	options := map[string]any{
		"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true,
		"types": []string{}, "skipLibCheck": true, "outDir": "out", "rewriteRelativeImportExtensions": true,
	}
	if variant&64 != 0 {
		options["module"], options["moduleResolution"] = "NodeNext", "NodeNext"
	}
	jsx := []string{"preserve", "react-native", "react-jsx", "none"}[variant%4]
	if jsx != "none" {
		options["jsx"] = jsx
	}
	if stock {
		options["noEmit"], options["allowImportingTsExtensions"] = true, true
	}
	config, _ := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{main}, "vibe": map[string]any{"effectGlobals": false, "effectModules": false}})
	return Project{Files: files, Config: string(config)}
}
func crossVariantStockCodes(t *testing.T, project Project) []string {
	t.Helper()
	tsc, err := stockTypeScript()
	if err != nil {
		Missing(t, "%v", err)
	}
	root := t.TempDir()
	for name, text := range project.Files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	config := filepath.Join(root, "tsconfig.json")
	if err := os.WriteFile(config, []byte(project.Config), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", config, "--pretty", "false")
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	codes := []string{}
	for _, m := range regexp.MustCompile("error (TS[0-9]+):").FindAllStringSubmatch(string(output), -1) {
		codes = append(codes, m[1])
	}
	slices.Sort(codes)
	if err != nil && len(codes) == 0 {
		t.Fatalf("stock TypeScript returned no diagnostics: %v\n%s", err, output)
	}
	return codes
}

// R25 OPUS-1 / VIP-39: explicit sibling substitutions match TypeScript.
// Decoys, type/value imports, re-exports, nesting, JSX and NodeNext vary nearby.
func FuzzNativeCrossVariantResolution(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"vibe-to-vibex", "vibex-to-vibe"} {
		for _, v := range []uint8{0, 1, 2, 3, 4, 8} {
			f.Add(key, v)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestNativeCrossVariantResolutionQuoted(t)
		if key != "vibe-to-vibex" && key != "vibex-to-vibe" {
			if len(key) == 0 {
				return
			}
			key = []string{"vibe-to-vibex", "vibex-to-vibe"}[int(key[0])%2]
		}
		gap := fmt.Sprintf("%s/%d", key, variant)
		expected := crossVariantStockCodes(t, crossVariantProject(key, variant, true, true))
		reference, err := w.Compile(t.Context(), crossVariantProject(key, variant, true, false))
		if err != nil {
			t.Fatal(err)
		}
		defer reference.Remove()
		if got := vibexNativeCodes(reference); !slices.Equal(got, expected) {
			t.Fatalf("native TypeScript control differs from stock: %s: want %v, got %v", gap, expected, got)
		}
		actual, err := w.Compile(t.Context(), crossVariantProject(key, variant, false, false))
		if err != nil {
			t.Fatal(err)
		}
		defer actual.Remove()
		if got := vibexNativeCodes(actual); !slices.Equal(got, expected) {
			Gap(t, crossVariantTarget, gap, "%s: stock TypeScript %v; native rename %v", crossVariantQuote, expected, got)
			return
		}
		if len(expected) == 0 {
			want, got := "", ""
			for path, text := range reference.Outputs {
				if strings.HasSuffix("/"+path, "/main.js") {
					want = text
				}
			}
			for path, text := range actual.Outputs {
				if strings.HasSuffix("/"+path, "/main.js") {
					got = text
				}
			}
			if want == "" {
				t.Fatal("native control emitted no main.js")
			}
			if want != got {
				Gap(t, crossVariantTarget, gap, "VIP-39 rename changes TypeScript emit:\nwant %s\ngot %s", want, got)
				return
			}
		}
		ExpectPending(t, crossVariantTarget, gap)
		ExpectPending(t, crossVariantTarget, specCorpusKey(t))
	})
}
