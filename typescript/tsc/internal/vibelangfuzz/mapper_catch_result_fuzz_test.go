package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperPlainCatchResultsQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "a plain arrow written inside an `effect` function is a plain function")
	chapterSays(t, "002-running.md", "The handler is always a function literal, and its syntax alone decides its kind")
}

func FuzzMapperPlainCatchResult(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"arrow", "block", "function", "parenthesized", "annotated-arrow", "annotated-function", "generic-function", "default-parameter", "zero-arrow", "zero-function", "this-only-function"} {
		for flags := uint8(0); flags < 4; flags++ {
			f.Add(key, flags)
		}
	}
	w := NewWorkspace(f)
	packageDir := filepath.Join(w.Dir, "node_modules", "vibelang-ts-mapper")
	if err := os.MkdirAll(packageDir, 0o700); err != nil {
		f.Fatal(err)
	}
	for _, name := range []string{"package.json", "prelude.d.ts"} {
		data, err := os.ReadFile(filepath.Join(Root(), "packages", "ts-mapper", name))
		if err != nil {
			f.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(packageDir, name), data, 0o600); err != nil {
			f.Fatal(err)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestMapperPlainCatchResultsQuoted(t)
		value := "E.succeed(error.length)"
		if flags&1 != 0 {
			value = "make(error.length)"
		}
		zeroValue := "E.succeed(3)"
		if flags&1 != 0 {
			zeroValue = "make(3)"
		}
		handler := "(error)=>" + value
		switch key {
		case "block":
			handler = "(error)=>{return " + value + "}"
		case "function":
			handler = "function(error){return " + value + "}"
		case "parenthesized":
			handler = "(" + handler + ")"
		case "annotated-arrow":
			handler = "(error): E.Effect<number> =>" + value
		case "annotated-function":
			handler = "function(error):E.Effect<number>{return " + value + "}"
		case "generic-function":
			handler = "function<T extends string>(error:T):E.Effect<number>{return " + value + "}"
		case "default-parameter":
			handler = "(error=\"bad\")=>" + value
		case "zero-arrow":
			handler = "() => " + zeroValue
		case "zero-function":
			handler = "function():E.Effect<number>{return " + zeroValue + "}"
		case "this-only-function":
			handler = "function(this:unknown):E.Effect<number>{return " + zeroValue + "}"
		}
		source := `import {Effect as E} from "effect";declare function make(n:number):E.Effect<number>;export effect function sample(){const program: E.Effect<number> = E.fail("bad") catch ` + handler + `;return try program}`
		if flags&2 != 0 {
			source = "// café 😀\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 0 {
			Gap(t, "FuzzMapperPlainCatchResult", key, "valid plain handler reports %v", p.Diagnostics)
		}
		checked := toolsCompile(t, w, "FuzzMapperPlainCatchResult", map[string]string{"main.ts": p.Text})
		defer checked.Remove()
		if HasError(checked.Diagnostics) {
			Gap(t, "FuzzMapperPlainCatchResult", key, "the plain handler's Effect must remain its success value: %v\n%s", checked.Diagnostics, p.Text)
		}
		if _, _, diags := vibelangmapper.Emit(source, vibelangmapper.FileContext{}); len(diags) != 0 {
			Gap(t, "FuzzMapperPlainCatchResult", key, "plain handler does not emit: %v", diags)
		}
	})
}
