package tsoptions_test

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-30: a legacy severity map is read from either placement, in every
// accepted config file and in the configs it extends. Each map keeps applying
// and reports EK3009 where it is written.
func TestLegacyDiagnosticsEveryConfigPlacement(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "jsconfig.json", "vibe.config.json"} {
		for _, place := range []string{"vibelang", "compilerOptions.vibelang"} {
			for _, inherited := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/inherited=%t", name, place, inherited), func(t *testing.T) {
					section := `"vibelang":{"diagnostics":{"EK4406":"off","EK9204":"error"}}`
					if place == "compilerOptions.vibelang" {
						section = `"compilerOptions":{` + section + `}`
					}
					origin := "/p/" + name
					files := map[string]string{origin: `{` + section + `,"files":["main.vibe"]}`, "/p/main.vibe": "export const n = 1"}
					if inherited {
						files["/p/base.json"] = files[origin]
						files[origin] = `{"extends":"./base.json","files":["main.vibe"]}`
						origin = "/p/base.json"
					}
					parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, vfstest.FromMap(files, tspath.CaseSensitive), nil)
					if len(errors) != 0 || len(parsed.Errors) != 0 {
						t.Fatalf("%v %v", errors, parsed.Errors)
					}
					// rule-evidence: docs/design/vips/0030-config-files.md#859518147e25f9cd | **Amended 2026-10-30: legacy configuration migration.** Both root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics` are recognized in all three config files and their extended configs.
					options := parsed.CompilerOptions().VibeLang
					if options == nil || options.Diagnostics["EK4406"] != "off" || options.Diagnostics["EK9204"] != "error" {
						t.Fatalf("legacy map not recognized: %+v", options)
					}
					ds := parsed.GetConfigFileParsingDiagnostics()
					if len(ds) != 1 {
						t.Fatalf("want one EK3009, got %v", ds)
					}
					d := ds[0]
					if d.Source() != "EK" || d.Code() != 3009 || d.Category() != diagnostics.CategoryWarning || d.File() == nil || string(d.File().FileName()) != origin {
						t.Fatalf("wrong migration warning: %s in %v", d.String(), d.File())
					}
				})
			}
		}
	}
}
