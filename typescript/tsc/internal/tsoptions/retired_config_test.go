package tsoptions_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-30 and VIP-4: both retired keys warn and have no effective state,
// regardless of value, config filename, legacy path or inheritance.
func TestRetiredConfigOptions(t *testing.T) {
	for _, name := range []string{"tsconfig.json", "jsconfig.json", "vibe.config.json"} {
		for _, place := range []string{"vibelang", "compilerOptions.vibelang", "vibe"} {
			for _, inherited := range []bool{false, true} {
				for _, value := range []string{`42`, `".js"`, `".ts"`, `"extensionless"`, `"invalid"`, `true`, `null`, `[]`, `{}`, `["@scope/*"]`, `[false,"["]`} {
					t.Run(fmt.Sprintf("%s/%s/inherited=%t/%s", name, place, inherited, value), func(t *testing.T) {
						keys := []string{"declarationImportStyle", "trustedPackages"}
						section := `"vibelang":{"declarationImportStyle":` + value + `,"trustedPackages":` + value + `}`
						if place == "compilerOptions.vibelang" {
							section = `"compilerOptions":{` + section + `}`
						}
						if place == "vibe" {
							keys = []string{"trustedPackages"}
							section = `"vibe":{"trustedPackages":` + value + `}`
						}
						origin := "/p/" + name
						files := map[string]string{origin: `{` + section + `,"files":["main.ts"]}`, "/p/main.ts": "export const n=1"}
						if inherited {
							files["/p/base.json"] = files[origin]
							files[origin] = `{"extends":"./base.json","files":["main.ts"]}`
							origin = "/p/base.json"
						}
						parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, vfstest.FromMap(files, tspath.CaseSensitive), nil)
						if len(errors) != 0 {
							t.Fatal(errors)
						}
						ds := parsed.GetConfigFileParsingDiagnostics()
						if len(ds) != len(keys) {
							t.Fatalf("want retirement warnings; got %v", ds)
						}
						for i, key := range keys {
							d := ds[i]
							code := int32(3010)
							if key == "declarationImportStyle" {
								code = 3011
							}
							if d.Source() != "EK" || d.Code() != code {
								t.Fatalf("wrong retirement code: %s", d.String())
							}
							if d.Category() != diagnostics.CategoryWarning || !strings.Contains(d.String(), key) || !strings.Contains(d.String(), "ignored") || d.File() == nil || string(d.File().FileName()) != origin || d.File().Text()[d.Pos():d.End()] != `"`+key+`"` {
								t.Fatalf("wrong retirement warning: %s", d.String())
							}
						}
						if o := parsed.CompilerOptions().VibeLang; o != nil && (o.DeclarationImportStyle != "" || len(o.TrustedPackages) != 0) {
							t.Fatalf("retired state retained: %+v", o)
						}
						shown, err := json.Marshal(tsoptions.ConvertToTSConfig(parsed, tspath.RootedFilePath("/p/"+name)))
						if err != nil {
							t.Fatal(err)
						}
						if strings.Contains(string(shown), "trustedPackages") || strings.Contains(string(shown), "declarationImportStyle") {
							t.Fatalf("retired showConfig state: %s", shown)
						}
					})
				}
			}
		}
	}
}

func TestRetiredConfigOptionsDoNotHideErrors(t *testing.T) {
	p := vibeConfig(t, `{"vibelang":{"trustedPackages":42,"declarationImportStyle":42,"typo":42},"files":["main.vibe"]}`, "{}")
	counts := map[diagnostics.Category]int{}
	for _, d := range p.GetConfigFileParsingDiagnostics() {
		counts[d.Category()]++
	}
	if counts[diagnostics.CategoryWarning] != 2 || counts[diagnostics.CategoryError] != 1 {
		t.Fatal(p.GetConfigFileParsingDiagnostics())
	}
}

func TestRetiredConfigBothPathsAndSeverityMigration(t *testing.T) {
	p := vibeConfig(t, `{"vibelang":{"trustedPackages":42,"declarationImportStyle":42,"diagnostics":{"EK4406":"off"}},"compilerOptions":{"vibelang":{"trustedPackages":null,"declarationImportStyle":{},"diagnostics":{"EK4406":"off"}}},"vibe":{"severities":{"EK3009":"off"}},"files":["main.vibe"]}`, "{}")
	ds := p.GetConfigFileParsingDiagnostics()
	if len(ds) != 4 {
		t.Fatalf("want four retirement warnings with EK3009 hidden, got %v", ds)
	}
	for _, d := range ds {
		if d.Category() != diagnostics.CategoryWarning || (d.Code() != 3010 && d.Code() != 3011) {
			t.Fatal(d)
		}
	}
	if p.CompilerOptions().VibeLang.Diagnostics["EK4406"] != "off" {
		t.Fatal("retirement lost independent legacy severity")
	}
}

func TestRetiredConfigSeverities(t *testing.T) {
	for _, severity := range []string{"warning", "error", "suggestion", "off"} {
		t.Run(severity, func(t *testing.T) {
			p := vibeConfig(t, `{"vibelang":{"declarationImportStyle":42,"trustedPackages":42},"vibe":{"trustedPackages":42,"severities":{"EK3010":"`+severity+`","EK3011":"`+severity+`"}},"files":["main.vibe"]}`, "{}")
			ds := p.GetConfigFileParsingDiagnostics()
			if severity == "off" {
				if len(ds) != 0 {
					t.Fatal(ds)
				}
				return
			}
			if len(ds) != 3 {
				t.Fatal(ds)
			}
			for _, d := range ds {
				if d.Category().Name() != severity {
					t.Fatal(d)
				}
			}
			if len(p.CompilerOptions().VibeLang.TrustedPackages) != 0 || p.CompilerOptions().VibeLang.DeclarationImportStyle != "" {
				t.Fatal("severity changes must not reactivate retired options")
			}
		})
	}
}
