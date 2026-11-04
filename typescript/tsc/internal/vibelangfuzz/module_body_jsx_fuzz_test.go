package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const moduleBodyJSXQuote = "moving it to a sibling " + "`.ts` file (`.tsx` for a body in `.vibex`) with its external-module classification preserved and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation."

func TestModuleBodyJSXQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), moduleBodyJSXQuote) {
		t.Fatalf("module body JSX rule no longer says %q", moduleBodyJSXQuote)
	}
}

var moduleBodyJSXKeys = []string{"element", "fragment", "callback", "generic", "contextual"}
var moduleBodyJSXForms = []string{
	"export const view = <div />",
	"export const view = <><span /></>",
	"export const view = <button onClick={() => process.cwd()} />",
	"export const id = <T,>(value: T) => value; export const view = <div>{id(1)}</div>",
	"export const view = <effect match='literal'>{() => 7}</effect>",
}

func FuzzModuleBodyJSXParity(f *testing.F) {
	startShortBudget(f)
	for _, key := range moduleBodyJSXKeys {
		f.Add(key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		index := slices.Index(moduleBodyJSXKeys, key)
		if index < 0 {
			index = int(variant) % len(moduleBodyJSXKeys)
		}
		key = moduleBodyJSXKeys[index]
		name := []string{"host", "view", "Native"}[int(variant)%3]
		body := moduleBodyJSXForms[index]
		source := "module " + name + " {\n" + body + "\n}\nexport * from " + name + "\n"
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibex", PathKey: "/main.vibex"}, source, core.ScriptKindTSX)
		modules := file.SupplementalSourceFiles()
		if len(modules) != 1 {
			Gap(t, "FuzzModuleBodyJSXParity", key, "expected one native body, got %d", len(modules))
			return
		}
		actual := modules[0]
		twin := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/body.tsx", PathKey: "/body.tsx"}, body, core.ScriptKindTSX)
		if !strings.HasSuffix(actual.FileName().AsString(), ".tsx") || actual.LanguageVariant != core.LanguageVariantJSX {
			Gap(t, "FuzzModuleBodyJSXParity", key, "body lost its native TSX filename or language variant")
		}
		if len(twin.Diagnostics()) != 0 {
			t.Fatalf("invalid TSX control: %v", twin.Diagnostics())
		}
		if len(file.Diagnostics()) != 0 || len(actual.Diagnostics()) != 0 {
			Gap(t, "FuzzModuleBodyJSXParity", key, "native JSX body diverges from TSX: outer=%v body=%v", file.Diagnostics(), actual.Diagnostics())
		}
	})
}
