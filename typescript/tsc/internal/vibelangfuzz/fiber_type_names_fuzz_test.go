package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const fiberTypeNamesQuote = "An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`"

func TestReservedFiberTypeNamesQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", fiberTypeNamesQuote)
	chapterSays(t, "900-appendices.md", "a `.vibex` file uses these productions unchanged, read with TypeScript's JSX language variant")
	chapterSays(t, "000-intro.md", "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.")
}

// This static oracle checks source declaration names and their exact diagnostic
// ranges. It does not infer reservation from a compiler error or compare Exits.
func FuzzReservedFiberTypeNames(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", fiberTypeNamesQuote)
	keys := []string{"alias", "interface", "enum", "const-enum", "alias-parameter", "interface-parameter", "class-parameter", "class-expression-parameter", "function-parameter", "effect-function-parameter", "plain-method-parameter", "effect-arrow-parameter"}
	shapes := []string{"type W=number;", "interface W{n:number}", "enum W{A}", "const enum W{A}", "type T<W>=W;", "interface I<W>{n:W}", "class C<W>{n!:W}", "const C=class<W>{n!:W};", "function g<W>(){}", "effect function g<W>(){}", "class C{m<W>(){}}", "const g=effect <W,>()=>1;"}
	homes := []string{"effect function f(){%s}", "effect function* f(){%s}", "const f=effect ()=>{%s};", "const p=effect {%s};", "class C{effect m(){%s}}", "effect function f(){uninterruptible {%s}}", "effect function f(){for concurrent(const n of [1]){%s}}", "effect function f(){for try(const n of Stream.make(1)){%s}}"}
	for _, key := range keys {
		for h := range homes {
			f.Add([]byte(key), uint8(h), uint8(0))
			f.Add([]byte(key), uint8(h), uint8(3))
			f.Add([]byte(key), uint8(h), uint8(16))
			f.Add([]byte(key), uint8(h), uint8(19))
		}
	}
	for _, v := range []uint8{8, 11, 24, 27} {
		f.Add([]byte("effect-arrow-parameter"), uint8(0), v)
	}
	f.Fuzz(func(t *testing.T, data []byte, home, variant uint8) {
		shape, _ := keyedChoice(keys, data)
		name := []string{"fork", "join"}[variant%2]
		written := name
		if variant&2 != 0 {
			written = fmt.Sprintf("\\u%04x%s", name[0], name[1:])
		}
		body := strings.ReplaceAll(shapes[shape], "W", written)
		if variant&4 != 0 {
			body = "/* declaration */" + body
		}
		source := fmt.Sprintf(homes[int(home)%len(homes)], body)
		if variant&16 != 0 {
			source = "function outer(){" + body + "}"
		}
		fileName := "/main.vibe"
		if variant&8 != 0 {
			fileName = "/main.vibex"
		}
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName)}, source)
		ds := file.Diagnostics()
		key := fmt.Sprintf("%s:%s:home=%d:variant=%d", keys[shape], name, int(home)%len(homes), variant%32)
		want := 1
		if variant&16 != 0 {
			want = 0
		}
		if len(ds) != want || want == 1 && (ds[0].Source() != "EK" || ds[0].Code() != 1702 || source[ds[0].Pos():ds[0].End()] != written) {
			Gap(t, "FuzzReservedFiberTypeNames", key, "%s; want %d EK1702 diagnostics at %q, got %v\n%s", fiberTypeNamesQuote, want, written, ds, source)
		}
	})
}
