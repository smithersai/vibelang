package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// Contextual names must remain values without replacing type annotations.
func TestSoftKeywordCatchArgumentNative(t *testing.T) {
	TestSoftKeywordsQuoted(t)
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	for _, word := range []string{"number", "unknown", "string", "boolean", "bigint", "symbol", "any", "never"} {
		for _, home := range vipgen.SoftKeywordHomes {
			shape := vipgen.SoftKeywordShape{Word: word, Form: "catch", Home: home, Use: "passed"}
			t.Run(shape.Key(), func(t *testing.T) {
				t.Parallel()
				_, native := shape.Sources()
				_ = stockDeclaration(t, w, tsc, Project{
					Files:  map[string]string{"main.ts": native, "soft-keyword-helper.ts": vipgen.SoftKeywordHelper, "package.json": "{\"type\":\"module\"}"},
					Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":["main.ts"]}`,
				}, "out/main.d.ts")
			})
		}
	}
}

// Exercise the generated reference itself as well as the standalone native twin.
func TestSoftKeywordCatchArgumentExit(t *testing.T) {
	TestSoftKeywordsQuoted(t)
	env := newVIPEnv(t)
	for _, word := range []string{"number", "unknown", "string", "boolean", "bigint", "symbol", "any", "never"} {
		for _, home := range []string{"plain", "field", "enum", "static", "module"} {
			shape := vipgen.SoftKeywordShape{Word: word, Form: "catch", Home: home, Use: "passed"}
			t.Run(shape.Key(), func(t *testing.T) {
				homes := []string{"plain", "field", "enum", "static", "module", "effect", "static-effect"}
				tail := []byte{0, 0, byte(slices.Index(vipgen.SoftKeywordWords, word)), byte(slices.Index(vipgen.SoftKeywordForms, "catch")), byte(slices.Index(homes, home)), byte(slices.Index(vipgen.SoftKeywordUses, "passed"))}
				p := vipgen.Generate(append(vipgen.Seed("vip17.soft-keyword-identifiers-plain"), tail...), nil)
				if p == nil || !strings.Contains(vipgen.PrintVibe(p), shape.Key()) {
					t.Fatal("the named input did not select its catch-binding shape")
				}
				run := env.run(t, p)
				for key, detail := range run.failures() {
					t.Errorf("%s: %s", key, detail)
				}
				if !slices.Contains(run.ref.Events, shape.Key()) || !slices.Contains(run.ref.Events, "2") {
					t.Errorf("the native catch argument was not observed: %q", run.ref.Events)
				}
			})
		}
	}
}
