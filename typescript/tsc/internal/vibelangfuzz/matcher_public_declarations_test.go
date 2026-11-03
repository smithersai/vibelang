package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const matcherDeclarationQuote = "An `error` or `schema error` keeps its static `[Symbol.customMatcher]` member, and every declaration file whose emitted text names `Symbol.customMatcher` begins with `/// <reference types=\"vibelang-runtime\" />`"

func TestMatcherPublicDeclarationsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), matcherDeclarationQuote) {
		t.Fatalf("chapter 1 no longer says %q", matcherDeclarationQuote)
	}
}

func FuzzMatcherPublicDeclarations(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"error/export", "error/alias", "schema-error/export", "schema-error/alias", "both/export", "ordinary/export"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Add("error/export", uint8(2))
	f.Add("schema-error/alias", uint8(3))
	for i, key := range []string{"error/namespace", "schema-error/namespace", "both/namespace", "ordinary/namespace"} {
		f.Add(key, uint8(4+i))
	}
	f.Add("both/namespace", uint8(12))
	f.Add("error/namespace", uint8(15))
	f.Add("schema-error/namespace", uint8(28))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMatcherPublicDeclarationsQuoted(t)
		kinds := []string{"error", "schema-error", "both", "ordinary"}
		kind := "error"
		if key != "" {
			kind = kinds[int(key[0])%len(kinds)]
		}
		for _, k := range kinds {
			if strings.HasPrefix(key, k+"/") {
				kind = k
			}
		}
		namespace := mode&4 != 0
		alias := strings.HasSuffix(key, "/alias") && !namespace
		prefix, suffix := "export ", ""
		if alias {
			prefix = ""
			suffix = "\nexport { E }"
		}
		field := "id: number"
		if mode&1 != 0 {
			field = "id: string"
		}
		source := prefix + "error E { " + field + " }" + suffix
		count := 1
		if kind == "schema-error" {
			source = prefix + "schema error E { " + field + " }" + suffix
		}
		if kind == "both" {
			source += "\nexport schema error S { " + field + " }"
			count = 2
		}
		if kind == "ordinary" {
			source = "export class E { id = 1 }"
			count = 0
		}
		matcher := "E"
		importName := "E"
		if namespace {
			locals := "export const Symbol = { local: true };\n"
			if mode&8 != 0 {
				locals += "export const globalThis = {}; export const $customMatcher_1 = 1;\n"
			}
			if mode&16 != 0 {
				source = "export namespace Nested {\n" + locals + source + "\n}"
				locals = ""
				matcher = "Box.Nested.E"
			} else {
				matcher = "Box.E"
			}
			source = "export namespace Box {\n" + locals + source + "\n}"
			importName = "Box"
		}
		file := "main.vibe"
		if mode&2 != 0 {
			file = "main.vibex"
		}
		configSource := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"" + file + "\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}, Config: configSource})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("source diagnostics: %v", r.Diagnostics)
			}
		}
		text := r.Outputs["out/main.d.ts"]
		if text == "" {
			t.Fatal("missing declaration output")
		}
		reference := "/// <reference types=\"vibelang-runtime\" />"
		if count == 0 {
			if strings.Contains(text, reference) || strings.Contains(text, "[Symbol.customMatcher]") {
				t.Fatalf("ordinary class acquired a generated matcher:\n%s", text)
			}
			return
		}
		if !strings.HasPrefix(text, reference) || strings.Count(text, reference) != 1 || strings.Count(text, "static [") != count {
			Gap(t, "FuzzMatcherPublicDeclarations", kind+"/boundary", "VIP-27: %s\n%s", matcherDeclarationQuote, text)
			return
		}
		consumer := `import { ` + importName + ` } from "./api.js"; const matcher = ` + matcher + `[Symbol.customMatcher]; const value: boolean | readonly [unknown] = matcher(null, {matchType:"extractor"}); export {value}`
		config := strings.Replace(DefaultConfig, `"skipLibCheck": true`, `"skipLibCheck": false`, 1)
		checked, err := w.Compile(t.Context(), Project{Files: map[string]string{"api.d.ts": text, "consumer.ts": consumer}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		for _, d := range checked.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzMatcherPublicDeclarations", kind+"/consumer", "VIP-27 stock-consumer boundary: %s\n%v\n%s", matcherDeclarationQuote, checked.Diagnostics, text)
				return
			}
		}
	})
}
