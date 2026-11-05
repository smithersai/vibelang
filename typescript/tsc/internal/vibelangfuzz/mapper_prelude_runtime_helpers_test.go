package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMapperPreludeRuntimeHelpersQuoted(t *testing.T) {
	TestPatternCacheProjectionQuoted(t)
}
func FuzzMapperPreludeRuntimeHelpers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"binding", "empty", "nested", "object", "collision", "unicode"}
	for _, key := range keys {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	prelude, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/prelude.d.ts"))
	if err != nil {
		f.Fatal(err)
	}
	pkg, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/package.json"))
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestMapperPreludeRuntimeHelpersQuoted(t)
		pattern := "[let value,...]"
		result := "value"
		prefix := ""
		switch key {
		case "empty":
			pattern = "[]"
			result = "subject"
		case "nested":
			pattern = "[[let value,...],...]"
		case "object":
			pattern = "{items:[let value,...]}"
		case "collision":
			prefix = "const $matchCache=7; const $matchCache2=8;\n"
		case "unicode":
			prefix = "const 値=7;\n"
		}
		source := prefix + "export function pick(subject:unknown):unknown { if(subject is " + pattern + ") return " + result + "; return undefined }\n"
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{FileName: filepath.Join(w.Dir, "control.vibe"), ModuleKey: "prelude-control"})
		if len(p.Diagnostics) != 0 {
			t.Fatalf("projection diagnostics: %v", p.Diagnostics)
		}
		proof := "\ntype Cache = typeof import(\"vibelang-ts-mapper/prelude\").$matchCache;\ntype RuntimeCache = typeof import(\"vibelang-runtime\").$matchCache;\nconst same: Cache extends RuntimeCache ? RuntimeCache extends Cache ? true : false : false = true;\n"
		files := map[string]string{"main.ts": p.Text + proof, "package.json": "{\"type\":\"module\"}", "node_modules/vibelang-ts-mapper/prelude.d.ts": string(prelude), "node_modules/vibelang-ts-mapper/package.json": string(pkg)}
		c, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		spans, _, err := stockSpans(t.Context(), tsc, c.Dir, "main.ts")
		if err != nil {
			t.Fatal(err)
		}
		var nativeErrors []string
		for _, d := range c.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				nativeErrors = append(nativeErrors, d.String())
			}
		}
		var stockErrors []stockSpan
		for _, d := range spans {
			if d.Category == "error" {
				stockErrors = append(stockErrors, d)
			}
		}
		if len(nativeErrors) != 0 || len(stockErrors) != 0 {
			t.Fatalf("%s/crlf=%v: native %v; stock %v\n%s", key, crlf, nativeErrors, stockErrors, p.Text)
		}
	})
}
