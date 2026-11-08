package tsoptions_test

import (
	"fmt"
	"maps"
	"reflect"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestVibeLegacyNullKeepsSelectedSection(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"} {
		for _, nullAt := range []string{"root", "nested"} {
			for _, selected := range []struct {
				text string
				want map[string]string
			}{
				{`{"diagnostics":{"EK4801":"off","EK4830":"warning"}}`, map[string]string{"EK4801": "off", "EK4830": "warning"}},
				{`{}`, nil},
				{`{"diagnostics":null}`, nil},
				{`{"diagnostics":{}}`, map[string]string{}},
			} {
				for _, base := range []string{`{}`, `{"vibelang":{"diagnostics":{"EK4802":"error"}}}`, `{"vibe":{"effectGlobals":false,"severities":{"EK0801":"off"}}}`, `{"vibelang":{"diagnostics":{"EK4802":"error"}},"vibe":{"effectGlobals":false,"severities":{"EK0801":"off"}}}`} {
					t.Run(name+"/"+nullAt+"/"+selected.text+"/"+base, func(t *testing.T) {
						sections := fmt.Sprintf(`"vibelang":null,"compilerOptions":{"vibelang":%s}`, selected.text)
						if nullAt == "nested" {
							sections = fmt.Sprintf(`"vibelang":%s,"compilerOptions":{"vibelang":null}`, selected.text)
						}
						fs := vfstest.FromMap(map[string]string{
							"/p/base.json":    base,
							"/p/" + name:      fmt.Sprintf(`{"extends":"./base.json",%s,"files":["main.vibe"]}`, sections),
							"/p/direct.json":  fmt.Sprintf(`{%s,"files":["main.vibe"]}`, sections),
							"/p/sibling.json": `{"extends":"./base.json","files":["main.vibe"]}`,
							"/p/main.vibe":    "export const value=1",
						}, tspath.CaseSensitive)
						cache := &memoCache{}
						read := func(path tspath.RootedFilePath) *tsoptions.ParsedCommandLine {
							c, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, cache)
							if len(errors) != 0 || len(c.Errors) != 0 {
								t.Fatalf("configuration errors: %v; %v", errors, c.Errors)
							}
							return c
						}
						sibling := read("/p/sibling.json").CompilerOptions().VibeLang
						var saved *core.VibeLangOptions
						if sibling != nil {
							v := *sibling
							v.Diagnostics = maps.Clone(sibling.Diagnostics)
							v.Severities = maps.Clone(sibling.Severities)
							saved = &v
						}
						direct := read("/p/direct.json").CompilerOptions().VibeLang
						if direct == nil {
							direct = &core.VibeLangOptions{}
						}
						if !maps.Equal(direct.Diagnostics, selected.want) {
							t.Fatalf("direct section selection: %+v; want %v", direct, selected.want)
						}
						c := read(tspath.RootedFilePath("/p/" + name))
						got := c.CompilerOptions().VibeLang
						if got == nil {
							got = &core.VibeLangOptions{}
						}
						if !maps.Equal(got.Diagnostics, selected.want) {
							t.Fatalf("inheritance lost selected child section: %+v; want %v", got, selected.want)
						}
						if saved != nil && (got.EffectGlobals != saved.EffectGlobals || !reflect.DeepEqual(got.Severities, saved.Severities)) {
							t.Fatalf("lost independent modern settings: %+v; base %+v", got, saved)
						}
						if !saved.Equals(read("/p/sibling.json").CompilerOptions().VibeLang) {
							t.Fatal("child mutated cached sibling")
						}
						shown, err := json.Marshal(tsoptions.ConvertToTSConfig(c, tspath.RootedFilePath("/p/"+name)))
						if err != nil {
							t.Fatal(err)
						}
						roundTrip := vibeConfig(t, string(shown), `{}`).CompilerOptions().VibeLang
						if roundTrip == nil {
							roundTrip = &core.VibeLangOptions{}
						}
						if !maps.Equal(roundTrip.Diagnostics, selected.want) {
							t.Fatalf("showConfig lost selected section: %s", shown)
						}
					})
				}
			}
		}
	}
}
