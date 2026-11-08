package tsoptions_test

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestVibeLegacyNullPreservesModernChild(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"} {
		for _, placement := range []string{"root", "nested"} {
			for _, base := range []string{`{}`, `{"vibelang":{"diagnostics":{"EK4801":"off"}}}`, `{"vibe":{"effectGlobals":false,"effectModules":true,"sidecarDir":"base-out","severities":{"EK0801":"off","EK4609":"off"}}}`, `{"vibelang":{"diagnostics":{"EK4801":"off"}},"vibe":{"effectGlobals":false,"effectModules":true,"sidecarDir":"base-out","severities":{"EK0801":"off","EK4609":"off"}}}`} {
				t.Run(name+"/"+placement+"/"+base, func(t *testing.T) {
					reset := `"vibelang":null`
					if placement == "nested" {
						reset = `"compilerOptions":{"vibelang":null}`
					}
					child := fmt.Sprintf(`{"extends":"./base.json",%s,"vibe":{"effectGlobals":true,"effectModules":false,"sidecarDir":"child-out","severities":{"EK0801":"error","EK0508":"off"}},"files":["main.vibe"]}`, reset)
					fs := vfstest.FromMap(map[string]string{
						"/p/base.json":    base,
						"/p/" + name:      child,
						"/p/sibling.json": `{"extends":"./base.json","files":["main.vibe"]}`,
						"/p/main.vibe":    "export const value = 1",
					}, tspath.CaseSensitive)
					cache := &memoCache{}
					read := func(path tspath.RootedFilePath) *tsoptions.ParsedCommandLine {
						config, errors := tsoptions.GetParsedCommandLineOfConfigFile(path, &core.CompilerOptions{}, nil, fs, cache)
						if len(errors) != 0 || len(config.Errors) != 0 {
							t.Fatalf("config errors: %v; %v", errors, config.Errors)
						}
						return config
					}
					siblingBefore := read("/p/sibling.json").CompilerOptions().VibeLang
					config := read(tspath.RootedFilePath("/p/" + name))
					options := config.CompilerOptions().VibeLang
					want := map[string]string{"EK0801": "error", "EK0508": "off"}
					if siblingBefore != nil && siblingBefore.Severities["EK4609"] == "off" {
						want["EK4609"] = "off"
					}
					if options == nil || options.EffectGlobals != core.TSTrue || options.EffectModules != core.TSFalse || options.SidecarDir != "/p/child-out" || !reflect.DeepEqual(options.Severities, want) || len(options.Diagnostics) != 0 {
						t.Fatalf("legacy reset lost modern child settings or retained legacy diagnostics: %+v; want severities %v", options, want)
					}
					if !siblingBefore.Equals(read("/p/sibling.json").CompilerOptions().VibeLang) {
						t.Fatal("reset mutated cached base for sibling")
					}
					shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, tspath.RootedFilePath("/p/"+name)))
					if err != nil {
						t.Fatal(err)
					}
					again := vibeConfig(t, string(shown), `{}`)
					roundTrip := again.CompilerOptions().VibeLang
					// The relocated config has its own directory; compare its other settings.
					if roundTrip == nil || roundTrip.EffectGlobals != options.EffectGlobals || roundTrip.EffectModules != options.EffectModules || !reflect.DeepEqual(roundTrip.Severities, want) || len(roundTrip.Diagnostics) != 0 {
						t.Fatalf("showConfig lost settings: %s", shown)
					}
				})
			}
		}
	}
}
