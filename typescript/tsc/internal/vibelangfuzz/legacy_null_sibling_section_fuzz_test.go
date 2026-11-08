package vibelangfuzz

import (
	"fmt"
	"maps"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func legacyNullSiblingQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", legacyNullModernQuote)
	chapterSays(t, "007-tooling.md", legacyNullModernMergeQuote)
}
func TestLegacyNullSiblingQuoted(t *testing.T) { legacyNullSiblingQuoted(t) }

// A selected child legacy object replaces inherited diagnostics even when its
// alternate location is null. Independently inherit modern keys and codes.
func FuzzLegacyNullSiblingSection(f *testing.F) {
	startShortBudget(f)
	legacyNullSiblingQuoted(f)
	keys := []string{"root-map", "nested-map", "root-empty", "nested-empty", "root-null-map", "nested-null-map", "root-array", "nested-array", "root-modern", "nested-modern", "root-empty-map", "nested-empty-map"}
	for _, key := range keys {
		for _, data := range [][]byte{{0}, {1}, {2}, {3}, {255}} {
			f.Add(key, data)
		}
	}
	f.Fuzz(func(t *testing.T, key string, data []byte) {
		pick := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		known := false
		for _, k := range keys {
			if k == key {
				known = true
				break
			}
		}
		if !known {
			key = keys[int(pick(0))%len(keys)]
		}
		file := []string{"tsconfig.json", "vibe.config.json", "jsconfig.json"}[pick(1)%3]
		code := []string{"EK4801", "EK4830", "EK4406"}[pick(2)%3]
		severity := []string{"off", "warning", "error"}[pick(3)%3]
		object := fmt.Sprintf(`{"diagnostics":{%q:%q}}`, code, severity)
		wantLegacy := map[string]string{code: severity}
		if strings.HasSuffix(key, "-empty") {
			object = `{}`
			wantLegacy = nil
		}
		if strings.HasSuffix(key, "-null-map") {
			object = `{"diagnostics":null}`
			wantLegacy = nil
		}
		if strings.HasSuffix(key, "-empty-map") {
			object = `{"diagnostics":{}}`
			wantLegacy = map[string]string{}
		}
		selected := fmt.Sprintf(`"vibelang":null,"compilerOptions":{"vibelang":%s}`, object)
		if strings.HasPrefix(key, "nested-") {
			selected = fmt.Sprintf(`"vibelang":%s,"compilerOptions":{"vibelang":null}`, object)
		}
		bases := `"./base.json"`
		wantModern := map[string]string{"EK0801": "off", "EK4609": "off"}
		if strings.HasSuffix(key, "-array") || pick(4)%2 != 0 {
			bases = `["./base.json","./later.json"]`
			wantModern["EK4609"] = "error"
		}
		globals, modules := core.TSFalse, core.TSTrue
		directory := "/p/base-out"
		modern := ""
		if strings.HasSuffix(key, "-modern") {
			value := pick(5)%2 == 0
			globals = core.TSFalse
			if value {
				globals = core.TSTrue
			}
			modules = core.TSFalse
			directory = "/p/child-out"
			level := []string{"error", "warning", "suggestion", "off"}[pick(6)%4]
			wantModern["EK0801"] = level
			modern = fmt.Sprintf(`,"vibe":{"effectGlobals":%t,"effectModules":false,"sidecarDir":"child-out","severities":{"EK0801":%q}}`, value, level)
		}
		fs := vfstest.FromMap(map[string]string{
			"/p/base.json":  `{"vibelang":{"diagnostics":{"EK4802":"error"}},"vibe":{"effectGlobals":false,"effectModules":true,"sidecarDir":"base-out","severities":{"EK0801":"off","EK4609":"off"}}}`,
			"/p/later.json": `{"compilerOptions":{"vibelang":{"diagnostics":{"EK9204":"off"}}},"vibe":{"severities":{"EK4609":"error"}}}`,
			"/p/" + file:    fmt.Sprintf(`{"extends":%s,%s%s,"files":["main.vibe"]}`, bases, selected, modern),
			"/p/main.vibe":  "export const value=1",
		}, tspath.CaseSensitive)
		c, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePath("/p/"+file), &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 || len(c.Errors) != 0 {
			t.Fatalf("configuration errors: %v; %v", errors, c.Errors)
		}
		got := c.CompilerOptions().VibeLang
		if got == nil || !maps.Equal(got.Diagnostics, wantLegacy) {
			Gap(t, "FuzzLegacyNullSiblingSection", key, "selected child section lost or inherited diagnostics restored: got %+v; want %v", got, wantLegacy)
		}
		if got == nil || got.EffectGlobals != globals || got.EffectModules != modules || got.SidecarDir != directory || !reflect.DeepEqual(got.Severities, wantModern) {
			Gap(t, "FuzzLegacyNullSiblingSection", key, "independent modern inheritance changed: got %+v; want globals %v modules %v directory %q severities %v", got, globals, modules, directory, wantModern)
		}
	})
}
