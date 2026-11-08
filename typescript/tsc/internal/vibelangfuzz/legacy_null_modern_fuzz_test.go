package vibelangfuzz

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const legacyNullModernQuote = "An explicit child legacy section replaces the inherited legacy section as a whole, rather than merging diagnostic entries; even an empty object or `null` clears the inherited legacy settings."
const legacyNullModernMergeQuote = "`extends` inherits `vibe` key by key: child keys win and missing keys come from the base."
const legacyNullModernSeverityQuote = "An invalid child entry displaces its inherited entry without restoring it: fall back to the Effect language-service setting where applicable, then the default."

func legacyNullModernQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{legacyNullModernQuote, legacyNullModernMergeQuote, legacyNullModernSeverityQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 7 no longer says %q", quote)
		}
	}
}
func TestLegacyNullModernQuoted(t *testing.T) { legacyNullModernQuoted(t) }

// Generate independent legacy resets and modern key/code winners, including
// later extended bases and invalid child entries. The expected map is computed
// directly from the chapter rules, without consulting the compiler merge.
func FuzzLegacyNullModern(f *testing.F) {
	startShortBudget(f)
	legacyNullModernQuoted(f)
	keys := []string{"root-child", "nested-child", "root-inherit", "nested-inherit", "root-invalid", "nested-invalid", "root-array", "nested-array", "root-empty", "nested-empty"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1}, {2}, {3}, {4}, {255}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		choice := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		found := false
		for _, known := range keys {
			if key == known {
				found = true
				break
			}
		}
		if !found {
			key = keys[int(choice(0))%len(keys)]
		}
		name := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[int(choice(1))%3]
		value := "null"
		if strings.HasSuffix(key, "-empty") {
			value = "{}"
		}
		reset := `"vibelang":` + value
		if strings.HasPrefix(key, "nested-") {
			reset = `"compilerOptions":{"vibelang":` + value + `}`
		}
		extends := `"./base.json"`
		if strings.HasSuffix(key, "-array") {
			extends = `["./base.json","./later.json"]`
		}
		severity := []string{"error", "warning", "suggestion", "off"}[int(choice(2))%4]
		code := []string{"EK0801", "EK3801", "EK38100"}[int(choice(4))%3]
		globals := choice(3)%2 == 0
		modern := fmt.Sprintf(`,"vibe":{"effectGlobals":%t,"effectModules":false,"sidecarDir":"child-out","severities":{%q:%q,"EK0508":"off"}}`, globals, code, severity)
		want := map[string]string{code: severity, "EK0508": "off", "EK4609": "off"}
		wantGlobals, wantModules := core.TSFalse, core.TSFalse
		if globals {
			wantGlobals = core.TSTrue
		}
		wantDir := "/p/child-out"
		wantErrors := 0
		if strings.HasSuffix(key, "-inherit") {
			modern = ""
			want = map[string]string{code: "off", "EK4609": "off"}
			wantGlobals, wantModules, wantDir = core.TSFalse, core.TSTrue, "/p/base-out"
		}
		if strings.HasSuffix(key, "-invalid") {
			modern = strings.Replace(modern, fmt.Sprintf(`%q:%q`, code, severity), fmt.Sprintf(`%q:42`, code), 1)
			delete(want, code)
			wantErrors = 1
		}
		if strings.HasSuffix(key, "-array") {
			want["EK0508"] = "off"
			want["EK4609"] = "error"
		}
		fs := vfstest.FromMap(map[string]string{
			"/p/base.json":  fmt.Sprintf(`{"vibelang":{"diagnostics":{"EK4801":"off"}},"vibe":{"effectGlobals":false,"effectModules":true,"sidecarDir":"base-out","severities":{%q:"off","EK4609":"off"}}}`, code),
			"/p/later.json": `{"vibe":{"effectGlobals":false,"severities":{"EK4609":"error","EK0508":"warning"}}}`,
			"/p/" + name:    fmt.Sprintf(`{"extends":%s,%s%s,"files":["main.vibe"]}`, extends, reset, modern),
			"/p/main.vibe":  "export const value=1",
		}, tspath.CaseSensitive)
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+name), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		if len(config.Errors) != wantErrors || (wantErrors != 0 && config.Errors[0].Code() != 3006) {
			Gap(t, "FuzzLegacyNullModern", key, "modern validation changed: %v", config.Errors)
		}
		options := config.CompilerOptions().VibeLang
		if options == nil || options.EffectGlobals != wantGlobals || options.EffectModules != wantModules || options.SidecarDir != wantDir || !reflect.DeepEqual(options.Severities, want) || len(options.Diagnostics) != 0 {
			Gap(t, "FuzzLegacyNullModern", key, "legacy reset must preserve independently merged modern options: got %+v; want globals %v modules %v directory %q severities %v", options, wantGlobals, wantModules, wantDir, want)
		}
	})
}
