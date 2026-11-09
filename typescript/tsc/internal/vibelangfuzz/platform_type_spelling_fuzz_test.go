package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const platformTypeSpellingQuote = "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is."

func TestPlatformTypeSpellingQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformTypeSpellingQuote)
}

var platformTypeSpellingNames = []struct{ key, name, typo string }{
	{"reader", "FileReader", "FileReaderr"},
	{"socket", "WebSocket", "WebSockeet"},
	{"xhr", "XMLHttpRequest", "XMLHttpRequst"},
}
var platformTypeSpellingForms = []string{"type", "implements", "extends", "value"}

func FuzzPlatformTypeSpelling(f *testing.F) {
	startShortBudget(f)
	var keys []string
	for _, row := range platformTypeSpellingNames {
		for _, form := range platformTypeSpellingForms {
			key := row.key + "-" + form
			keys = append(keys, key)
			for _, mode := range []byte{0, 1, 64} {
				f.Add(key, mode)
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		TestPlatformTypeSpellingQuoted(t)
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		name, form, _ := strings.Cut(key, "-")
		index := slices.IndexFunc(platformTypeSpellingNames, func(row struct{ key, name, typo string }) bool { return row.key == name })
		row := platformTypeSpellingNames[index]
		ext := []string{".vibe", ".vibex"}[mode&1]
		native := mode&64 != 0
		if native {
			ext = []string{".ts", ".tsx"}[mode&1]
		}
		source := "export type Value = " + row.typo
		switch form {
		case "implements":
			source = "export class Value implements " + row.typo + " {}"
		case "extends":
			source = "export class Value extends " + row.typo + " {}"
		case "value":
			source = "export const value = " + row.typo
		case "type":
			if mode&2 != 0 {
				source = "export type Value = Array<" + row.typo + ">"
			}
			if mode&4 != 0 {
				source = "export type Value = [" + row.typo + "]"
			}
		}
		if mode&8 != 0 {
			source = "namespace App { " + source + " }"
		}
		if mode&16 != 0 {
			source = "// retain diagnostic offsets: λ\r\n" + source
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[],"lib":["ESNext","DOM"]},"files":["main%s"]}`, ext)
		fs := bundled.WrapFS(vfstest.FromMap(map[string]string{"/project/package.json": `{"type":"module"}`, "/project/tsconfig.json": config, "/project/main" + ext: source}, tspath.CaseSensitive))
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		ds := program.GetSemanticDiagnostics(t.Context(), nil)
		if len(ds) != 1 {
			t.Fatalf("invalid typo fixture: %v", ds)
		}
		d := ds[0]
		allowed := native || form == "type" || form == "implements"
		want := int32(2304)
		if allowed {
			want = 2552
		}
		if d.Source() != "" || d.Code() != want || d.Category() != diagnostics.CategoryError || d.File().Text()[d.Pos():d.End()] != row.typo {
			Gap(t, "FuzzPlatformTypeSpelling", key, "erased types keep native suggestions while extends reads a value; want TS%d, got %s", want, d.String())
		}
		if allowed && !strings.Contains(d.String(), "Did you mean '"+row.name+"'") {
			Gap(t, "FuzzPlatformTypeSpelling", key, "native type suggestion missing: %s", d.String())
		}
	})
}
