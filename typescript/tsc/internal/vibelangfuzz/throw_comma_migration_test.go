package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const throwCommaMigrationQuote = "For a legacy comma separator, `vibelang --fix` and `--fix --fix-vip-only` parenthesize the whole throw expression while preserving its operand."

func TestThrowCommaMigrationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), throwCommaMigrationQuote) {
		t.Fatal("throw-comma migration rule changed")
	}
}

func FuzzThrowCommaMigration(f *testing.F) {
	startShortBudget(f)
	keys := []string{"array", "argument", "object", "sequence"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestThrowCommaMigrationQuoted(t)
		operand := "e"
		if mode&1 != 0 {
			operand = "/* reason */ (e)"
		}
		throw := "throw " + operand
		expr := ""
		switch key {
		case "argument":
			expr = "first(ok ? 1 : " + throw + ", 2)"
		case "object":
			expr = "{ value: ok ? 1 : " + throw + ", tail: 2 }"
		case "sequence":
			expr = "(ok ? 1 : " + throw + ", 2)"
		default:
			key = "array"
			expr = "[ok ? 1 : " + throw + ", 2]"
		}
		source := fmt.Sprintf("export effect function f(ok: boolean, e: string) { return %s; }\nfunction first(a: number, b: number) { return a; }\n", expr)
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		before := toolsCompile(t, w, "FuzzThrowCommaMigration", map[string]string{"main.vibe": source})
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{VIPOnly: true})
		fixed := source
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		want := strings.Replace(source, throw, "("+throw+")", 1)
		if result.Err != nil || len(result.Refused) != 0 || fixed != want {
			Gap(t, "FuzzThrowCommaMigration", key, "grouping failed: err=%v refused=%v\n%s\nwant %s", result.Err, result.Refused, fixed, want)
			return
		}
		after := toolsCompile(t, w, "FuzzThrowCommaMigration", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzThrowCommaMigration", key+":types", "%v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{VIPOnly: true})
		if again.Err != nil || len(again.Files) != 0 {
			Gap(t, "FuzzThrowCommaMigration", key+":idempotence", "%+v", again)
		}
	})
}
