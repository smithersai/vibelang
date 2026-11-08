package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func provideObjectHeadQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("900-appendices.md")
	for _, quote := range []string{"Provider = LeftHandSideExpression", "| ConditionalExpression"} {
		if !strings.Contains(text, quote) {
			t.Fatalf("provider expression grammar moved: %s", quote)
		}
	}
}
func TestProvideObjectHeadQuoted(t *testing.T) { provideObjectHeadQuoted(t) }

func FuzzProvideObjectHead(f *testing.F) {
	startShortBudget(f)
	provideObjectHeadQuoted(f)
	keys := []string{"member", "literal", "template", "nested", "spread", "getter", "call", "conditional", "binding", "list", "multiline", "identifier"}
	for _, key := range keys {
		for _, data := range [][]byte{{0, 0, 0}, {1, 1, 1}, {2, 2, 2}, {255, 255, 255}} {
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
			if key == k {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(pick(0))%len(keys)]
		}
		field := []string{"layer", "capability", "λ"}[int(pick(0))%3]
		templates := map[string]string{
			"member":      "{%[1]s:Layer.empty}.%[1]s",
			"literal":     "{%[1]s:Layer.empty}[\"%[1]s\"]",
			"template":    "{%[1]s:Layer.empty}[\x60%[1]s\x60]",
			"nested":      "{box:{%[1]s:Layer.empty}}.box.%[1]s",
			"spread":      "{...{%[1]s:Layer.empty}}.%[1]s",
			"getter":      "{get %[1]s(){return Layer.empty}}.%[1]s",
			"call":        "{%[1]s:()=>Layer.empty}.%[1]s()",
			"conditional": "{%[1]s:true}.%[1]s ? Layer.empty : Layer.empty",
			"binding":     "{%[1]s:Key}.%[1]s = implementation",
			"list":        "{%[1]s:Layer.empty}.%[1]s, {%[1]s:Layer.empty}.%[1]s",
			"multiline":   "{\n%[1]s:Layer.empty\n}.%[1]s",
		}
		head := ""
		if key != "identifier" {
			head = fmt.Sprintf(templates[key], field)
		}
		prefix := "effect function f()"
		if pick(1)%2 != 0 {
			prefix = "function f()"
		}
		vibe := prefix + "{provide " + head + " {return 1}}"
		native := "function f(){const provider=(" + head + ")}"
		if key == "identifier" {
			controls := []string{
				"function f(provide:number){provide\n{}}",
				"function f(provide:number){provide;{}}",
				"function f(provide:()=>void){provide()}",
				"function f(provide:number[]){provide[0]}",
				"function f(provide:unknown){provide={value:1}}",
				"function f(provide:number,a:number){return provide/a/{value:2}.value}",
			}
			vibe = controls[int(pick(0))%len(controls)]
			native = vibe
		}
		kind := core.ScriptKindTS
		vibeName, nativeName := "/main.vibe", "/main.ts"
		if pick(2)%2 != 0 {
			kind = core.ScriptKindTSX
			vibeName, nativeName = "/main.vibex", "/main.tsx"
		}
		parse := func(name, source string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, kind)
			var codes []int32
			for _, d := range file.Diagnostics() {
				codes = append(codes, d.Code())
			}
			return codes
		}
		if codes := parse(nativeName, native); len(codes) != 0 {
			t.Fatalf("native expression/control rejected: %v; %s", codes, native)
		}
		if codes := parse(vibeName, vibe); len(codes) != 0 {
			Gap(t, "FuzzProvideObjectHead", key, "ordinary object provider/control rejected: %v; %s", codes, vibe)
		}
	})
}
