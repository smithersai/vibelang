package tsoptions_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"reflect"
	"strings"
	"testing"
)

func TestVibeSeveritiesValidation(t *testing.T) {
	for _, test := range []struct {
		value, span string
		code        int32
	}{
		{`{"severities":{"EK4701":"error"}}`, `"EK4701"`, 3006},
		{`{"severities":{"EK3800":"off"}}`, `"EK3800"`, 3006},
		{`{"severities":{"EK38131":"off"}}`, `"EK38131"`, 3006},
		{`{"severities":{"EK9999":"off"}}`, `"EK9999"`, 3006},
		{`{"severities":{"":"off"}}`, `""`, 3006},
		{`{"severities":{"EK0801":"info"}}`, `"info"`, 3006},
		{`{"severities":{"EK0801":1}}`, `1`, 3006},
		{`{"severities":{"EK0801":null}}`, `null`, 3006},
		{`{"severities":{"EK0801":[]}}`, `[]`, 3006},
		{`{"severities":[]}`, `[]`, 3007},
		{`{"severities":null}`, `null`, 3007},
		{`{"effectGlobal":false}`, `"effectGlobal"`, 3007},
		{`{"":false}`, `""`, 3007},
		{`{"effectGlobals":"no"}`, `"no"`, 3007},
		{`{"effectModules":1}`, `1`, 3007},
		{`false`, `false`, 3007},
		{`null`, `null`, 3007},
	} {
		t.Run(test.value, func(t *testing.T) {
			text := "{\n// 😀\n\"vibe\":" + test.value + `,"files":["main.vibe"]}`
			config := vibeConfig(t, text, "{}")
			if len(config.Errors) != 1 {
				t.Fatalf("want one EK%d, got %v", test.code, config.Errors)
			}
			d := config.Errors[0]
			if d.Source() != "EK" || d.Code() != test.code || d.File() == nil || text[d.Pos():d.End()] != test.span {
				t.Fatalf("wrong diagnostic: %s at %d:%d", d.String(), d.Pos(), d.End())
			}
		})
	}
}

func TestVibeSeveritiesRoundTripAndInheritance(t *testing.T) {
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		t.Run(severity, func(t *testing.T) {
			base := `{"vibe":{"effectGlobals":false,"severities":{"EK0508":"warning","EK0801":"off"}}}`
			text := `{"extends":"./base.json","vibe":{"effectModules":false,"severities":{"EK0801":"` + severity + `","EK3801":"` + severity + `","EK0703":"` + severity + `","EK4609":"` + severity + `","EK4610":"` + severity + `"}},"files":["main.vibe"]}`
			config := vibeConfig(t, text, base)
			if len(config.Errors) != 0 {
				t.Fatal(config.Errors)
			}
			want := map[string]string{"EK0508": "warning", "EK0801": severity, "EK3801": severity, "EK0703": severity, "EK4609": severity, "EK4610": severity}
			if config.CompilerOptions().VibeLang == nil || !reflect.DeepEqual(config.CompilerOptions().VibeLang.Severities, want) {
				t.Fatalf("severities not merged: %+v", config.CompilerOptions().VibeLang)
			}
			shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, "/project/tsconfig.json"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(shown), `"vibe":`) || strings.Contains(string(shown), `"diagnostics":`) {
				t.Fatalf("legacy showConfig: %s", shown)
			}
			again := vibeConfig(t, string(shown), "{}")
			if len(again.Errors) != 0 || !reflect.DeepEqual(again.CompilerOptions().VibeLang, config.CompilerOptions().VibeLang) {
				t.Fatalf("round trip: %s: %v", shown, again.Errors)
			}
		})
	}
}

func TestVibeSeverityLegacyMigration(t *testing.T) {
	for _, text := range []string{
		`{"vibelang":{"diagnostics":{"EK4609":"off"}},"files":["main.vibe"]}`,
		`{"compilerOptions":{"vibelang":{"diagnostics":{"EK4609":"off"}}},"files":["main.vibe"]}`,
		`{"vibelang":{"tracing":"all","diagnostics":{"EK4609":"off"}},"vibe":{"severities":{"EK4609":"warning"}},"files":["main.vibe"]}`,
		"{ // keep me\n\"files\":[\"main.vibe\"],\"vibelang\":{\"diagnostics\":{\"EK4609\":\"off\"}}}",
		`{"vibelang":{"diagnostics":{"EK4609":"off"}}}`,
	} {
		t.Run(text, func(t *testing.T) {
			fixed, changed := tsoptions.MigrateLegacySeverities("/project/tsconfig.json", text)
			if !changed || strings.Contains(fixed, `"diagnostics"`) || !strings.Contains(fixed, `"severities"`) {
				t.Fatalf("not migrated: %s", fixed)
			}
			config := vibeConfig(t, fixed, "{}")
			for _, d := range config.Errors {
				if d.Source() == "EK" {
					t.Fatalf("migration error: %s", d.String())
				}
			}
			if strings.Contains(text, "keep me") && !strings.Contains(fixed, "keep me") {
				t.Fatal("lost comment")
			}
			if again, changed := tsoptions.MigrateLegacySeverities("/project/tsconfig.json", fixed); changed || again != fixed {
				t.Fatalf("not idempotent: %s", again)
			}
			old := vibeConfig(t, text, "{}")
			found := false
			for _, d := range old.GetConfigFileParsingDiagnostics() {
				if d.Source() == "EK" && d.Code() == 3009 {
					found = true
				}
			}
			if !found {
				t.Fatal("missing migration warning")
			}
		})
	}
}

func TestVibeSeveritiesExtendsArrayAndSiblings(t *testing.T) {
	fs := vfstest.FromMap(map[string]string{
		"/p/a.json":        `{"vibe":{"effectGlobals":false,"severities":{"EK4609":"off","EK4610":"warning"}}}`,
		"/p/b.json":        `{"vibe":{"severities":{"EK4609":"warning","EK3801":"off"}}}`,
		"/p/tsconfig.json": `{"extends":["./a.json","./b.json"],"vibe":{"severities":{"EK3801":"error"}},"files":["main.vibe"]}`,
		"/p/sibling.json":  `{"extends":"./a.json","files":["main.vibe"]}`,
		"/p/main.vibe":     "export const n=1",
	}, tspath.CaseSensitive)
	var cache tsoptions.ExtendedConfigCache
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/p/tsconfig.json", &core.CompilerOptions{}, nil, fs, cache)
	if len(errors) != 0 || len(parsed.Errors) != 0 {
		t.Fatalf("%v %v", errors, parsed.Errors)
	}
	want := map[string]string{"EK4609": "warning", "EK4610": "warning", "EK3801": "error"}
	if !reflect.DeepEqual(parsed.CompilerOptions().VibeLang.Severities, want) {
		t.Fatalf("array merge: %+v", parsed.CompilerOptions().VibeLang)
	}
	sibling, _ := tsoptions.GetParsedCommandLineOfConfigFile("/p/sibling.json", &core.CompilerOptions{}, nil, fs, cache)
	if got := sibling.CompilerOptions().VibeLang.Severities; got["EK4609"] != "off" || len(got) != 2 {
		t.Fatalf("base mutated: %v", got)
	}
}

func TestVibeSeveritiesLegacyCoexistence(t *testing.T) {
	base := `{"vibelang":{"tracing":"all","trustedPackages":["example"]},"vibe":{"severities":{"EK4610":"warning"}}}`
	for _, test := range []struct{ override, tracing string }{
		{`"vibe":{"severities":{"EK4609":"off"}}`, "all"},
		{`"compilerOptions":{"vibelang":{}}`, ""},
		{`"compilerOptions":{"vibelang":null}`, ""},
		{`"vibelang":null`, ""},
		{`"vibelang":{"tracing":"none"},"vibe":{"severities":{"EK4609":"off"}}`, "none"},
	} {
		t.Run(test.override, func(t *testing.T) {
			config := vibeConfig(t, `{"extends":"./base.json",`+test.override+`,"files":["main.vibe"]}`, base)
			if len(config.Errors) != 0 {
				t.Fatal(config.Errors)
			}
			options := config.CompilerOptions().VibeLang
			if options == nil || options.Tracing != test.tracing || options.Severities["EK4610"] != "warning" {
				t.Fatalf("lost independent sections: %+v", options)
			}
			shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, "/project/tsconfig.json"))
			if err != nil {
				t.Fatal(err)
			}
			again := vibeConfig(t, string(shown), "{}")
			if !options.Equals(again.CompilerOptions().VibeLang) {
				t.Fatalf("round trip lost settings: %s", shown)
			}
		})
	}
}
