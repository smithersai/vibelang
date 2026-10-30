package tsoptions_test

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func vibeConfig(t *testing.T, text string, base string) *tsoptions.ParsedCommandLine {
	t.Helper()
	fs := vfstest.FromMap(map[string]string{
		"/project/tsconfig.json": text,
		"/project/base.json":     base,
		"/project/main.vibe":     "export const value = 1",
	}, tspath.CaseSensitive)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config read failed: %v", errors)
	}
	return config
}

// D34 and D241 permit only the listed policies. --showConfig must preserve
// every accepted policy and tracing mode so it can be used as a new config.
func TestVibeLangConfigRoundTrip(t *testing.T) {
	for _, tracing := range []string{"none", "exported", "all"} {
		for _, category := range []string{"error", "warning", "off"} {
			t.Run(tracing+"/"+category, func(t *testing.T) {
				var policies []string
				want := &core.VibeLangOptions{TrustedPackages: []string{"@smthrs/*", "exact-package"}, Tracing: tracing, Diagnostics: map[string]string{}}
				for _, code := range core.VibeLangAdjustableCodes {
					policies = append(policies, fmt.Sprintf("%q:%q", code, category))
					want.Diagnostics[code] = category
				}
				config := vibeConfig(t, `{"compilerOptions":{"vibelang":{"trustedPackages":["@smthrs/*","exact-package"],"tracing":"`+tracing+`","diagnostics":{`+strings.Join(policies, ",")+`}}},"files":["main.vibe"]}`, "{}")
				if len(config.Errors) != 0 || !reflect.DeepEqual(config.CompilerOptions().VibeLang, want) {
					t.Fatalf("accepted settings changed: %+v; errors %v", config.CompilerOptions().VibeLang, config.Errors)
				}
				shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, "/project/tsconfig.json"))
				if err != nil {
					t.Fatal(err)
				}
				again := vibeConfig(t, string(shown), "{}")
				if len(again.Errors) != 0 || !reflect.DeepEqual(again.CompilerOptions().VibeLang, want) {
					t.Fatalf("showConfig did not round-trip: %s; errors %v", shown, again.Errors)
				}
				// Stable lexical order is independent of the input/map order.
				if strings.Index(string(shown), fmt.Sprintf("%q", slices.Min(core.VibeLangAdjustableCodes))) > strings.Index(string(shown), fmt.Sprintf("%q", slices.Max(core.VibeLangAdjustableCodes))) {
					t.Fatalf("diagnostic policies are not sorted: %s", shown)
				}
			})
		}
	}
	config := vibeConfig(t, `{"compilerOptions":{"vibelang":{}},"files":["main.vibe"]}`, "{}")
	shown, err := json.Marshal(tsoptions.ConvertToTSConfig(config, "/project/tsconfig.json"))
	if err != nil || !strings.Contains(string(shown), `"vibelang":{}`) {
		t.Fatalf("empty settings should not invent explicit defaults: %s, %v", shown, err)
	}
}

func TestVibeLangConfigDiagnosticLocations(t *testing.T) {
	for _, test := range []struct {
		name, value, span, message string
		code                       int32
	}{
		{"unknown setting", `{"trace":"all"}`, `"trace"`, "vibelang.trace", 5023},
		{"empty setting", `{"":{}}`, `""`, "'vibelang.'", 5023},
		{"empty diagnostic code", `{"diagnostics":{"":"off"}}`, `""`, "vibelang.diagnostics. is not adjustable", 5023},
		{"soundness diagnostic", `{"diagnostics":{"EK9201":"off"}}`, `"EK9201"`, "vibelang.diagnostics.EK9201", 5023},
		{"TypeScript diagnostic", `{"diagnostics":{"EK4813":"off"}}`, `"EK4813"`, "vibelang.diagnostics.EK4813", 5023},
		{"category spelling", `{"diagnostics":{"EK9204":"Warning"}}`, `"Warning"`, "'error', 'warning', 'off'", 6046},
		{"category type", `{"diagnostics":{"EK4403":false}}`, `false`, "vibelang.diagnostics.EK4403", 6046},
		{"diagnostics type", `{"diagnostics":[]}`, `[]`, "vibelang.diagnostics", 5024},
		{"diagnostics null", `{"diagnostics":null}`, `null`, "vibelang.diagnostics", 5024},
		{"tracing spelling", `{"tracing":"ALL"}`, `"ALL"`, "'none', 'exported', 'all'", 6046},
		{"trusted packages type", `{"trustedPackages":"@smthrs/*"}`, `"@smthrs/*"`, "vibelang.trustedPackages", 5024},
		{"trusted package element", `{"trustedPackages":[false]}`, `false`, "vibelang.trustedPackages", 5024},
		{"trusted package glob", `{"trustedPackages":["["]}`, `"["`, "valid package-name glob", 6046},
		{"tracing type", `{"tracing":42}`, `42`, "vibelang.tracing", 6046},
	} {
		t.Run(test.name, func(t *testing.T) {
			// The emoji before the options also exercises byte-based AST spans.
			text := "{\n// 😀 config\n\"compilerOptions\":{\"vibelang\":" + test.value + "},\"files\":[\"main.vibe\"]}"
			config := vibeConfig(t, text, "{}")
			if len(config.Errors) != 1 {
				t.Fatalf("want one error, got %v", config.Errors)
			}
			d := config.Errors[0]
			if d.Code() != test.code || d.File() == nil || text[d.Pos():d.End()] != test.span || !strings.Contains(d.String(), test.message) {
				t.Fatalf("wrong config diagnostic: %s at %d:%d", d.String(), d.Pos(), d.End())
			}
		})
	}
}

func TestVibeLangConfigInheritance(t *testing.T) {
	base := `{"compilerOptions":{"vibelang":{"trustedPackages":["@smthrs/*"],"tracing":"all","diagnostics":{"EK4403":"off"}}},"files":["main.vibe"]}`
	for _, test := range []struct {
		name, override string
		want           *core.VibeLangOptions
	}{
		{"inherit", "", &core.VibeLangOptions{TrustedPackages: []string{"@smthrs/*"}, Tracing: "all", Diagnostics: map[string]string{"EK4403": "off"}}},
		{"replace", `,"compilerOptions":{"vibelang":{"tracing":"exported"}}`, &core.VibeLangOptions{Tracing: "exported"}},
		{"empty object replaces", `,"compilerOptions":{"vibelang":{}}`, &core.VibeLangOptions{}},
		{"null resets", `,"compilerOptions":{"vibelang":null}`, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := vibeConfig(t, `{"extends":"./base.json"`+test.override+`}`, base)
			if len(config.Errors) != 0 || !reflect.DeepEqual(config.CompilerOptions().VibeLang, test.want) {
				t.Fatalf("inherited settings: %+v; want %+v; errors %v", config.CompilerOptions().VibeLang, test.want, config.Errors)
			}
		})
	}
}

func TestVibeLangNonAdjustableDiagnostic(t *testing.T) {
	for _, code := range []string{"EK4402", "EK9201", "EK4813"} {
		t.Run(code, func(t *testing.T) {
			text := `{"compilerOptions":{"vibelang":{"diagnostics":{"` + code + `":"off"}}},"files":["main.vibe"]}`
			config := vibeConfig(t, text, "{}")
			if len(config.Errors) != 1 {
				t.Fatalf("want one error, got %v", config.Errors)
			}
			d := config.Errors[0]
			if !strings.Contains(d.String(), code+" is not adjustable") || strings.Contains(d.String(), "Unknown compiler option") {
				t.Fatalf("wrong policy diagnostic: %s", d.String())
			}
			advice := ""
			for _, child := range d.MessageChain() {
				advice += child.String()
			}
			for _, adjustable := range core.VibeLangAdjustableCodes {
				if !strings.Contains(advice, adjustable) {
					t.Errorf("missing adjustable code %s: %s", adjustable, d.String())
				}
			}
			if options := config.CompilerOptions().VibeLang; options != nil && len(options.Diagnostics) != 0 {
				t.Fatalf("invalid policy accepted: %+v", options)
			}
		})
	}
}

// Stock TypeScript and the tools built on it, such as typescript-eslint and an
// editor's TypeScript server, reject an unknown compiler option (TS5023), so
// VibeLang also reads its settings from the tsconfig's top level, which they
// ignore. Settings there are validated as in compilerOptions and inherited
// through extends (D275).
func TestVibeLangTopLevelSettings(t *testing.T) {
	inherited := vibeConfig(t, `{"extends":"./base.json","files":["main.vibe"]}`, `{"compilerOptions":{"strict":true},"vibelang":{"trustedPackages":["@smthrs/*"]}}`)
	if len(inherited.Errors) != 0 || inherited.CompilerOptions().VibeLang == nil || !reflect.DeepEqual(inherited.CompilerOptions().VibeLang.TrustedPackages, []string{"@smthrs/*"}) {
		t.Fatalf("extends did not carry top-level settings: %+v; errors %v", inherited.CompilerOptions().VibeLang, inherited.Errors)
	}
	own := vibeConfig(t, `{"vibelang":{"tracing":"all"},"files":["main.vibe"]}`, "{}")
	if len(own.Errors) != 0 || own.CompilerOptions().VibeLang == nil || own.CompilerOptions().VibeLang.Tracing != "all" {
		t.Fatalf("top-level settings without compilerOptions: %+v; errors %v", own.CompilerOptions().VibeLang, own.Errors)
	}
	invalid := vibeConfig(t, `{"compilerOptions":{},"vibelang":{"trustedPackage":["zod"]},"files":["main.vibe"]}`, "{}")
	if len(invalid.Errors) == 0 {
		t.Fatal("an unknown top-level vibelang key was accepted")
	}
}
