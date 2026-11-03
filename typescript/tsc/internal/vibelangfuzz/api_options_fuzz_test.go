package vibelangfuzz

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const apiOptionsQuote = "child keys win and missing keys come from the base"

func TestAPIOptionsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), apiOptionsQuote) {
		t.Fatalf("chapter 007 no longer says %q", apiOptionsQuote)
	}
}

// Static VIP-30 oracle: parsing then sending the effective options over the
// compiler API must preserve independently selected inherited settings.
func FuzzAPIOptions(f *testing.F) {
	startShortBudget(f)
	keys := []string{"severity", "globals", "modules", "sidecar", "inherited"}
	for _, key := range keys {
		f.Add(key, uint8(0), uint8(0))
		f.Add(key, uint8(3), uint8(3))
	}
	f.Fuzz(func(t *testing.T, key string, setting, shape uint8) {
		TestAPIOptionsQuoted(t)
		severity := []string{"error", "warning", "suggestion", "off"}[setting%4]
		code := []string{"EK4855", "EK4609", "EK0801", "EK3801"}[shape%4]
		enabled := setting%2 == 0
		settings := fmt.Sprintf(`{"effectGlobals":%t,"effectModules":%t,"sidecarDir":".vibe/decl","severities":{%q:%q}}`, enabled, !enabled, code, severity)
		name := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[shape%3]
		text := `{"compilerOptions":{"strict":true,"noEmitOnError":true},"vibe":` + settings + `,"files":["main.vibe"]}`
		base := "{}"
		if key == "inherited" {
			base = `{"vibe":` + settings + `}`
			text = `{"extends":"./base.json","compilerOptions":{"strict":true,"noEmitOnError":true},"vibe":{"severities":{"EK4854":"off"}},"files":["main.vibe"]}`
		}
		fs := vfstest.FromMap(map[string]string{"/project/" + name: text, "/project/base.json": base, "/project/main.vibe": "export const x = 1;"}, tspath.CaseSensitive)
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized("/project/"+name), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 || config == nil || len(config.Errors) != 0 {
			t.Fatalf("valid config failed: %v %v", config, errors)
		}
		encoded, err := json.Marshal(config.CompilerOptions())
		if err != nil {
			t.Fatal(err)
		}
		var raw tsoptions.RawCompilerOptions
		if err := json.Unmarshal(encoded, &raw); err != nil {
			t.Fatal(err)
		}
		got, diagnostics := raw.Finalize(tspath.RootedDirectoryPath("/project"))
		want := config.CompilerOptions().VibeLang
		if len(diagnostics) != 0 || got.VibeLang == nil ||
			!reflect.DeepEqual(got.VibeLang.Severities, want.Severities) ||
			got.VibeLang.EffectGlobals != want.EffectGlobals || got.VibeLang.EffectModules != want.EffectModules ||
			got.VibeLang.SidecarDir != "/project/.vibe/decl" || got.Strict != core.TSTrue ||
			got.NoEmitOnError != core.TSTrue || want.Severities[code] != severity {
			Gap(t, "FuzzAPIOptions", key, "VIP-30 effective options lost at API boundary: wire=%s got=%+v diagnostics=%v", encoded, got.VibeLang, diagnostics)
		}
	})
}
