package parser_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestProvideObjectLiteralHead(t *testing.T) {
	heads := []string{
		"{layer:Layer.empty}.layer",
		"{layer:Layer.empty}[\"layer\"]",
		"{layer:Layer.empty}[\x60layer\x60]",
		"{box:{layer:Layer.empty}}.box.layer",
		"{...{layer:Layer.empty}}.layer",
		"{get layer(){return Layer.empty}}.layer",
		"{make:()=>Layer.empty}.make()",
		"{cond:true}.cond ? Layer.empty : Layer.empty",
		"{key:K}.key = value",
		"{layer:Layer.empty}.layer, {layer:Layer.empty}.layer",
		"{\nlayer:Layer.empty\n}.layer",
		"{\"layer\":Layer.empty}[\"layer\"]",
	}
	for _, kind := range []core.ScriptKind{core.ScriptKindTS, core.ScriptKindTSX} {
		name := "/main.vibe"
		if kind == core.ScriptKindTSX {
			name = "/main.vibex"
		}
		for _, prefix := range []string{"effect function f()", "function f()"} {
			for i, head := range heads {
				for _, paren := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/%d/parenthesized=%t", name, prefix, i, paren), func(t *testing.T) {
						if paren {
							head = "(" + head + ")"
						}
						source := prefix + "{provide " + head + " {return 1}}"
						file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, kind)
						if len(file.Diagnostics()) != 0 {
							var codes []int32
							for _, d := range file.Diagnostics() {
								codes = append(codes, d.Code())
							}
							t.Fatalf("provider head rejected: %v; source %s", codes, source)
						}
					})
				}
			}
		}
	}
}

func TestProvideObjectHeadIdentifierControls(t *testing.T) {
	controls := []string{
		"function f(provide:number){provide\n{}}",
		"function f(provide:number){provide;{}}",
		"function f(provide:()=>void){provide()}",
		"function f(provide:number[]){provide[0]}",
		"function f(provide:unknown){provide={value:1}}",
		"function f(provide:number){return provide+{value:1}.value}",
		"function f(provide:number,a:number){return provide/a/{value:2}.value}",
		"function f(provide:(n:number)=>number){provide(1)\n{}}",
	}
	for _, kind := range []core.ScriptKind{core.ScriptKindTS, core.ScriptKindTSX} {
		for _, source := range controls {
			t.Run(fmt.Sprintf("%d/%s", kind, source), func(t *testing.T) {
				parse := func(name string) []int32 {
					file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name)}, source, kind)
					var codes []int32
					for _, d := range file.Diagnostics() {
						codes = append(codes, d.Code())
					}
					return codes
				}
				vibe, ts := "/main.vibe", "/main.ts"
				if kind == core.ScriptKindTSX {
					vibe, ts = "/main.vibex", "/main.tsx"
				}
				if got, want := parse(vibe), parse(ts); !reflect.DeepEqual(got, want) {
					t.Fatalf("identifier changed: got %v; native %v", got, want)
				}
			})
		}
	}
}
