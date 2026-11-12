package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperMemberTypeSafetyQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "A function's kind is decided by a keyword on the function, never by its body or by a type.")
	chapterSays(t, "005-services.md", "A written binding keeps its ordinary TypeScript meaning: an imported, aliased or local `Effect` shadows the implicit binding.")
	chapterSays(t, "005-services.md", "It is derived from the package, the file and the name:")
}

func mapperMemberTypeSafetySource(key string, salt byte) (source, keep string) {
	switch key {
	case "alias":
		types := []string{`"burn" | "freeze"`, `"burn"`, "number", "{ value: number }", "readonly number[]", "(number)"}
		typ := types[int(salt)%len(types)]
		keep = "function pick(value: Effect): Effect { return value }"
		source = "type Effect = " + typ + "; " + keep
		switch salt / 6 % 7 {
		case 1:
			source = "function outer(): void { " + source + " }"
		case 2:
			source = "type Effect<T> = T; function pick(value: Effect<number>): Effect<number> { return value }"
			keep = "function pick(value: Effect<number>): Effect<number> { return value }"
		case 3:
			source = "interface Effect { value: number }; " + keep
		case 4:
			keep = "function pick(value: Effect.Effect<number>): Effect.Effect<number> { return value }"
			source = "namespace Effect { export type Effect<A> = A }; " + keep
		case 5:
			source = "declare const selector: number; switch (selector) { case 0: type Effect = " + typ + "; break; case 1: " + keep + " }"
		case 6:
			source = "declare const selector: number; switch (selector) { case 0: " + keep + "; break; default: type Effect = " + typ + "; }"
		}
	case "service":
		keys := []string{"k", "Symbol.iterator", `"key"`, "42", "(k)", "`key`"}
		source = `const k = "key"; service Users { static readonly [` + keys[int(salt)%len(keys)] + `] = "app/Users"; find(id: string): string! }`
		if salt/6%2 != 0 {
			source = `const k = "key"; type Shape = { find(id: string): string! }; service Users: Shape { static readonly [` + keys[int(salt)%len(keys)] + `] = "app/Users" }`
		}
		if salt/12%2 != 0 {
			source += "; function main() { return Users.pipe() }"
		}
		keep = "safety#Users"
	default:
		names := []string{"[Symbol.iterator]", "[key]", `["value"]`, "0", `"name"`, "['call']"}
		keep = names[int(salt)%len(names)]
		optional := ""
		if salt/6%2 != 0 {
			optional = "?"
		}
		shape := "{ " + keep + optional + ": number }"
		prefix, success := `declare const key: unique symbol; `, shape
		switch salt / 12 % 3 {
		case 1:
			prefix += "type Shape = " + shape + "; "
			success = "Shape"
		case 2:
			prefix += "interface Shape " + shape + "; "
			success = "Shape"
		}
		source = prefix + "function f(): Effect<" + success + "> { return () => 1 }"
	}
	return source, keep
}

func FuzzMapperMemberTypeSafety(f *testing.F) {
	startShortBudget(f)
	keys := []string{"alias", "service", "success"}
	for _, key := range keys {
		for _, salt := range []byte{0, 1, 2, 3, 4, 5, 6, 12, 18, 24, 30, 36} {
			f.Add(key, salt)
		}
	}
	f.Fuzz(func(t *testing.T, input string, salt byte) {
		TestMapperMemberTypeSafetyQuoted(t)
		index, _ := keyedChoice(keys, []byte(input))
		key := keys[index]
		source, keep := mapperMemberTypeSafetySource(key, salt)
		for _, project := range []func(string, vibelangmapper.FileContext) vibelangmapper.Projection{vibelangmapper.Project, vibelangmapper.Executable} {
			p := project(source, vibelangmapper.FileContext{ModuleKey: "safety", Lint: salt%2 != 0})
			if !strings.Contains(p.Text, keep) {
				Gap(t, "FuzzMapperMemberTypeSafety", fmt.Sprintf("%s/%d", key, salt), "lost %q:\n%s", keep, p.Text)
			}
			if err := spanmap.New(p.Segments).Validate(p.Text, source); err != nil {
				t.Fatal(err)
			}
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/member-safety.ts")}, source, core.ScriptKindTS)
		vibelangmapper.FormDiagnostics(file)
	})
}
