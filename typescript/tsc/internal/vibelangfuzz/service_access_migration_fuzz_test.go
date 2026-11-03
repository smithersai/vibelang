package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestServiceAccessMigrationQuoted(t *testing.T) {
	TestCatchScopeFixQuoted(t)
	if !strings.Contains(SpecText("005-services.md"), "const users = try Users") {
		t.Fatal("review the service/reference migration controls against chapter5")
	}
}

// The migration request requires the old zero-argument service-access spelling
// to repair to the already normative bare tag. It does not make tags callable.
func FuzzServiceAccessMigration(f *testing.F) {
	startShortBudget(f)
	for _, kind := range []string{"class", "reference", "value", "namespace", "callable"} {
		f.Add(kind, byte(0))
		f.Add(kind, byte(1))
	}
	f.Fuzz(func(t *testing.T, kind string, variant byte) {
		TestServiceAccessMigrationQuoted(t)
		name := "Env"
		if variant&1 != 0 {
			name = "NamedEnv"
		}
		var declaration, call, bare string
		switch kind {
		case "class":
			declaration = "class " + name + " extends Context.Service<" + name + ", { n: number }>()(" + fmt.Sprintf("%q", name) + ") {}"
			call, bare = name+"()", name
		case "reference":
			declaration = "const " + name + " = Context.Reference<{n:number}>(" + fmt.Sprintf("%q", name) + ", {defaultValue: () => ({n:1})});"
			call, bare = name+"()", name
		case "value":
			declaration = "const " + name + " = Context.Service<{n:number}>(" + fmt.Sprintf("%q", name) + ");"
			call, bare = name+"()", name
		case "callable":
			declaration = "function " + name + "() { return Effect.succeed({n:1}); }"
			call, bare = name+"()", name+"()"
		case "namespace":
			declaration = "namespace " + name + " { export class " + name + " extends Context.Service<" + name + ", {n:number}>()(" + fmt.Sprintf("%q", name) + ") {} }"
			call, bare = name+"()", name+"."+name
		default:
			return
		}
		prefix := "import * as Context from \"effect/Context\";\nimport * as Effect from \"effect/Effect\";\n" + declaration + "\n"
		source := func(read string) string {
			return prefix + "export const read = effect { const env = try " + read + "; return env.n; };\n"
		}
		w := NewWorkspace(t)
		control := toolsCompile(t, w, "FuzzServiceAccessMigration", map[string]string{"main.vibe": source(bare)})
		defer control.Remove()
		if !toolsErrorFree(control) {
			t.Fatalf("admitted service or ordinary-call control must compile: %v\n%s", SortedKeys(Keys(control.Dir, control.Diagnostics)), source(bare))
		}
		files := map[string]string{"main.vibe": source(call)}
		before := toolsCompile(t, w, "FuzzServiceAccessMigration", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatal("invalid own project config")
		}
		var result *vibelang.FixResult
		toolsRun(t, "FuzzServiceAccessMigration", "fix", Archive(files), nil, func() {
			result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		if result.Err != nil {
			t.Fatalf("service migration fix failed: %v", result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if _, ok := fixed[rel]; !ok {
				t.Fatalf("fix changed foreign file %s", rel)
			}
			fixed[rel] = file.Text
		}
		after := toolsCompile(t, w, "FuzzServiceAccessMigration", fixed)
		defer after.Remove()
		key := "service-call:" + kind
		if !toolsErrorFree(after) {
			Gap(t, "FuzzServiceAccessMigration", key, "VIP1/9 migration request: repair legacy zero-argument service access to the admitted bare form; got %v\nsource:\n%s\nfixed:\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), source(call), Archive(fixed))
		}
		ExpectPending(t, "FuzzServiceAccessMigration", key)
		ExpectPending(t, "FuzzServiceAccessMigration", specCorpusKey(t))
	})
}
