package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-17 and Appendix A reserve binding names in the parser's source Effect
// context. Type names use the same reservation; member names and source
// callable/initializer boundaries retain their own contexts.
func TestVibeLangReservedFiberTypeNames(t *testing.T) {
	shapes := []string{
		"type W=number;", "interface W{n:number}", "enum W{A}", "const enum W{A}",
		"type T<W>=W;", "interface I<W>{n:W}", "class C<W>{n!:W}",
		"const C=class<W>{n!:W};",
		"interface I{m<W>(n:W):W}",
		"interface I{<W>(n:W):W}",
	}
	homes := []string{
		"effect function f(){%s}", "effect function* f(){%s}",
		"const f=effect ()=>{%s};", "const f=effect {%s};",
		"class C{effect m(){%s}}", "const o={effect m(){%s}};",
		"effect function f(){uninterruptible {%s}}",
		"effect function f(){for concurrent(const n of [1]){%s}}",
		"effect function f(){for try(const n of Stream.make(1)){%s}}",
	}
	for _, fileName := range []string{"/main.vibe", "/main.vibex"} {
		for _, word := range []string{"fork", "join"} {
			for _, home := range homes {
				for _, shape := range shapes {
					t.Run(fmt.Sprintf("%s/%s/%s/%s", fileName, word, home, shape), func(t *testing.T) {
						source := fmt.Sprintf(home, strings.ReplaceAll(shape, "W", word))
						file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName)}, source, core.ScriptKindTS)
						ds := file.Diagnostics()
						if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1702 || source[ds[0].Pos():ds[0].End()] != word {
							t.Fatalf("want exactly EK1702 at the declaration name; got %v\n%s", ds, source)
						}
					})
				}
			}
		}
	}

	for _, source := range []string{
		"type fork=number;interface join{};enum fork2{A}",
		"function f<fork>(){type join=number;interface fork{}}",
		"async function f<fork>(){type join=number;interface fork{}}",
		"effect function f(){function g<T>(){type join=number}}",
		"effect function f(){const g=function fork<T>(){type fork=number}}",
		"effect function f(){const g=()=>{interface join{}}}",
		"effect function f(){class C{m<T>(){type join=number}}}",
		"effect function f(){const o={m<T>(){type fork=number}}}",
		"effect function f(){class C{x=do{type fork=number;1}}}",
		"effect function f(){enum E{A=do{type join=number;1}}}",
		"effect function f(){type T={fork:number;join():void};type U=[fork:number];enum E{fork,join}}",
		"effect function f(){type C<T>=T extends {n:infer fork}?fork:never;type M={[join in 'n']:number}}",
		"effect function f(){type T=<fork>(x:fork)=>fork}",
		"effect function f(){type T=new<join>(x:join)=>object}",
		"effect function f(){type T={m<fork>(x:fork):fork}}",
		"effect function f(){type T={<join>(x:join):join}}",
		"effect function f(){const g:(fork:number)=>number=x=>x}",
	} {
		f, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		if ds := f.Diagnostics(); len(ds) != 0 {
			t.Errorf("control: %v\n%s", ds, source)
		}
	}
}

// The TypeScript counterpart reads every callable's type-parameter list in
// its enclosing context, before the formal value parameters enter the
// callable's own context. Native parse diagnostics are checked separately.
func TestVibeLangFiberGenericHeadContext(t *testing.T) {
	shapes := []string{
		"function g<W>(){}", "effect function g<W>(){}", "async function g<W>(){}",
		"function* g<W>(){}", "effect function* g<W>(){}", "async function* g<W>(){}",
		"const g=function<W>(){};", "const g=effect function<W>(){};",
		"const g=async function<W>(){};", "const g=function*<W>(){};",
		"const g=effect function*<W>(){};", "const g=async function*<W>(){};",
		"const g=<W>()=>1;", "const g=effect <W>()=>1;", "const g=async <W>()=>1;",
		"class C{m<W>(){}}", "class C{effect m<W>(){}}", "class C{async m<W>(){}}",
		"class C{*m<W>(){}}", "class C{effect *m<W>(){}}",
		"const o={m<W>(){}};", "const o={effect m<W>(){}};", "const o={async m<W>(){}};",
	}
	for _, word := range []string{"fork", "join"} {
		for _, effect := range []bool{false, true} {
			for _, shape := range shapes {
				prefix := "function"
				if effect {
					prefix = "effect function"
				}
				source := prefix + " outer(){" + strings.ReplaceAll(shape, "W", word) + "}"
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
				ds := file.Diagnostics()
				want := 0
				if effect {
					want = 1
				}
				if len(ds) != want || want == 1 && (ds[0].Code() != 1702 || source[ds[0].Pos():ds[0].End()] != word) {
					t.Errorf("want %d reserved type-parameter errors, got %v\n%s", want, ds, source)
				}
			}
		}
	}
}

// A comma keeps a generic arrow unambiguous under the native JSX grammar.
func TestVibeLangFiberGenericHeadJSX(t *testing.T) {
	for _, word := range []string{"fork", "join"} {
		for _, prefix := range []string{"function", "effect function"} {
			for _, modifier := range []string{"", "async ", "effect "} {
				source := prefix + " outer(){const g=" + modifier + "<" + word + ",>()=>1;return 1}"
				file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibex", PathKey: "/main.vibex"}, source)
				ds := file.Diagnostics()
				want := 0
				if prefix == "effect function" {
					want = 1
				}
				if len(ds) != want || want == 1 && (ds[0].Code() != 1702 || source[ds[0].Pos():ds[0].End()] != word) {
					t.Errorf("JSX generic head wants %d EK1702, got %v: %s", want, ds, source)
				}
			}
		}
	}
}
