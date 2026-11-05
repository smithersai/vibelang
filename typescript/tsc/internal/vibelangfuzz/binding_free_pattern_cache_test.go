package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestBindingFreePatternCacheQuoted(t *testing.T) { TestPatternCacheProjectionQuoted(t) }
func FuzzBindingFreePatternCache(f *testing.F) {
	startShortBudget(f)
	keys := []string{"empty", "literal", "nested", "object", "negated", "alternative", "collision"}
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
	// Supply the real runtime helper type to isolate lexical binding from the
	// separately tested checking-prelude export contract.
	if !regexp.MustCompile(`(?m)^export[^\n]*\$matchCache`).Match(prelude) {
		prelude = append(prelude, []byte("\nexport { $matchCache } from \"vibelang-runtime\";\n")...)
	}
	pkg, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/package.json"))
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestBindingFreePatternCacheQuoted(t)
		pattern := "[]"
		prefix := ""
		switch key {
		case "literal":
			pattern = "[1]"
		case "nested":
			pattern = "[[]]"
		case "object":
			pattern = "{items:[]}"
		case "negated":
			pattern = "not []"
		case "alternative":
			pattern = "[] or [1]"
		case "collision":
			prefix = "const $matchCache1=7; const $matchCache=8;\n"
		}
		source := prefix + "export function pick(subject:unknown):boolean{return subject is " + pattern + "}\n"
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			t.Fatal(p.Diagnostics)
		}
		files := map[string]string{"main.ts": p.Text, "package.json": "{\"type\":\"module\"}", "node_modules/vibelang-ts-mapper/prelude.d.ts": string(prelude), "node_modules/vibelang-ts-mapper/package.json": string(pkg)}
		c, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		for _, d := range c.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s native: %s\n%s", key, d.String(), p.Text)
			}
		}
		spans, _, err := stockSpans(t.Context(), tsc, c.Dir, "main.ts")
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range spans {
			if d.Category == "error" {
				t.Fatalf("%s stock: %s\n%s", key, d, p.Text)
			}
		}
	})
}
