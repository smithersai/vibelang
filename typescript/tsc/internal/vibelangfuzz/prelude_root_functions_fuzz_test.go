package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const rootFunctionImportQuote = "Emitted code imports each namespace from `effect/<Module>` and each function from `effect/Function`, under a fresh name."

func TestPreludeRootFunctionImportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), rootFunctionImportQuote) {
		t.Fatal(rootFunctionImportQuote)
	}
}
func FuzzPreludeRootFunctionImports(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("005-services.md"), rootFunctionImportQuote) {
		f.Fatal(rootFunctionImportQuote)
	}
	keys := []string{}
	for _, name := range []string{"pipe", "flow", "identity", "absurd", "cast", "hole"} {
		for _, form := range []string{"value", "alias", "type"} {
			key := name + ":" + form
			keys = append(keys, key)
			f.Add([]byte(key + "\x00\x00"))
			f.Add([]byte(key + "\x00\x01"))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestPreludeRootFunctionImportsQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		valid := false
		for _, candidate := range keys {
			if candidate == key {
				valid = true
				break
			}
		}
		if !valid {
			key = keys[len(data)%len(keys)]
		}
		name, form, _ := strings.Cut(key, ":")
		source := "export const value=" + name
		if form == "alias" {
			source = "const selected=" + name + ";export const value=selected"
		}
		if form == "type" {
			source = "export type Fn=typeof " + name
		}
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// preserve root binding\n" + strings.ReplaceAll(source, "value", "café")
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": `{"type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzPreludeRootFunctionImports", key, "%s: %s", rootFunctionImportQuote, d.String())
				return
			}
		}
		js := r.Outputs["out/main.js"]
		if js == "" || strings.Contains(js, "vibelang-runtime") || form != "type" && !strings.Contains(js, "effect/Function") {
			Gap(t, "FuzzPreludeRootFunctionImports", key, "%s; JS=%s", rootFunctionImportQuote, js)
			return
		}
		ExpectPending(t, "FuzzPreludeRootFunctionImports", key)
		ExpectPending(t, "FuzzPreludeRootFunctionImports", specCorpusKey(t))
	})
}
