package vibelangfuzz

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const provideKeywordEscapeQuote = "\x60provide\x60 is a contextual keyword, and its providers and block must be on one line, as with \x60async\x60."

func provideKeywordEscapesQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("../vips/0012-provide.md"), provideKeywordEscapeQuote) {
		t.Fatal("provide contextual keyword rule moved")
	}
}
func TestProvideKeywordEscapesQuoted(t *testing.T) { provideKeywordEscapesQuoted(t) }

// Compare keyword consumption with native async, retaining ordinary escaped
// bindings, calls, division and newline boundaries as native identifier uses.
func FuzzProvideKeywordEscapes(f *testing.F) {
	startShortBudget(f)
	provideKeywordEscapesQuoted(f)
	keys := []string{"keyword-top", "keyword-effect", "keyword-plain", "keyword-nested", "keyword-multiline", "call", "division", "binding", "linebreak"}
	for _, key := range keys {
		for _, data := range [][]byte{{0, 0}, {1, 1}, {2, 2}, {3, 3}, {255, 255}, {6, 1, 0, 1}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		pick := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		known := false
		for _, k := range keys {
			if k == key {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(pick(0))%len(keys)]
		}
		mode := pick(1) % 4
		escaped := func(word string) string {
			if mode == 0 {
				return word
			}
			var b strings.Builder
			for i, ch := range word {
				if i == int(pick(0))%len(word) || mode == 3 {
					if mode == 2 {
						fmt.Fprintf(&b, "\\u{%x}", ch)
					} else {
						fmt.Fprintf(&b, "\\u%04x", ch)
					}
				} else {
					b.WriteRune(ch)
				}
			}
			return b.String()
		}
		word := escaped("provide")
		templates := map[string]string{
			"keyword-top":       "%[1]s Layer.empty {}",
			"keyword-effect":    "effect function f(){%[1]s Layer.empty {}}",
			"keyword-plain":     "function f(){%[1]s Layer.empty {}}",
			"keyword-nested":    "effect function f(){{%[1]s Layer.empty {}}}",
			"keyword-multiline": "effect function f(){%[1]s Layer.mergeAll(\nLayer.empty,\nLayer.empty) {}}",
			"call":              "function f(%[1]s:(n:number)=>number){return %[1]s(1)}",
			"division":          "function f(%[1]s:number,a:number){return %[1]s / a / {n:2}.n}",
			"binding":           "const %[1]s=1;export{%[1]s};",
			"linebreak":         "function f(%[1]s:number){%[1]s\nvalue\n{}}",
		}
		source := fmt.Sprintf(templates[key], word)
		kind := core.ScriptKindTS
		vibeName, nativeName := "/main.vibe", "/main.ts"
		if pick(3)%2 != 0 {
			kind = core.ScriptKindTSX
			vibeName, nativeName = "/main.vibex", "/main.tsx"
		}
		parse := func(name, text string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, text, kind)
			var codes []int32
			for _, d := range file.Diagnostics() {
				codes = append(codes, d.Code())
			}
			return codes
		}
		twin := source
		if strings.HasPrefix(key, "keyword-") {
			twin = escaped("async") + " function f(){}"
		}
		got, want := parse(vibeName, source), parse(nativeName, twin)
		if strings.HasPrefix(key, "keyword-") && mode != 0 && (len(want) != 1 || want[0] != 1260) {
			t.Fatalf("native async escape control changed: %v", want)
		}
		if !reflect.DeepEqual(got, want) {
			Gap(t, "FuzzProvideKeywordEscapes", key, "keyword lexical diagnostics differ from TypeScript: got %v; want %v; source %q", got, want, source)
		}
	})
}
