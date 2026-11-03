package vibelang

import (
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// collisionFiles returns a project of count modules that each write Effect.M,
// the property a checker hook records while it checks the file.
func collisionFiles(count int) (map[string]string, []string) {
	files := computedKeyFiles(false)
	effect := "/workspace/x/src/node_modules/effect/"
	files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts","default":"./index.js"},"./Effect":{"types":"./Effect.d.ts"},"./Array":{"types":"./Array.d.ts"}}}`
	files[effect+"index.d.ts"] = `export * as Effect from "./Effect.js"; export * as Array from "./Array.js"`
	files[effect+"Array.d.ts"] = `export declare const of: <A>(a: A) => ReadonlyArray<A>`
	files["/workspace/x/src/node_modules/vibelang-runtime/index.d.ts"] = `export * as Effect from "effect/Effect"; export * as Array from "effect/Array"; export * from "./match.js"`
	var names []string
	for i := range count {
		name := fmt.Sprintf("m%d.vibe", i)
		names = append(names, name)
		files["/workspace/x/src/"+name] = fmt.Sprintf("export const a%[1]d = Effect.Array.of(%[1]d)\nexport const b%[1]d = Effect.Array.of(a%[1]d)\n", i)
	}
	quoted := make([]string, len(names))
	for i, name := range names {
		quoted[i] = `"` + name + `"`
	}
	files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext"},"files":[` + strings.Join(quoted, ",") + `]}`
	return files, names
}

// A file's lowering runs after planFile released the checker, while the plan
// of another file on the same checker records more Effect.M references. It
// reads a copy taken under the lock. Without one, foldkit's build stopped with
// "concurrent map read and map write" in (*lowering).visit (foldkit-8). Only
// the race detector sees the race reliably, so smoke.sh runs this with -race.
func TestLoweringInParallel(t *testing.T) {
	t.Parallel()
	files, names := collisionFiles(32)
	for range 8 {
		p := computedKeyProgram(t, files)
		var outputs atomic.Int32 // the emitters of a program write in parallel
		result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(string(name), ".js") {
				outputs.Add(1)
				if strings.Contains(text, "Effect.Array") {
					t.Errorf("%s kept Effect.Array:\n%s", name, text)
				}
			}
			return nil
		}})
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("emit: %s", d.String())
			}
		}
		if n := int(outputs.Load()); n != len(names) {
			t.Fatalf("emitted %d files, want %d", n, len(names))
		}
	}
}

// A plan outlives the checker's lock, so no map of it may be one the checker
// goes on writing. This is the same rule deterministically, for each map that
// planning reads from checker state.
func TestPlanCopiesCheckerMaps(t *testing.T) {
	t.Parallel()
	files, names := collisionFiles(2)
	p := computedKeyProgram(t, files)
	file := p.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/" + names[0]))
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	seeded := preludeStateOf(c)
	seeded.intrinsics = map[*ast.Node]bool{}
	plan := newFilePlan()
	populateFilePlan(c, file, plan)
	if len(plan.collisionModules) == 0 {
		t.Fatal("the plan recorded no Effect.Array reference")
	}
	later := p.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/" + names[1])).AsNode()
	collisionModules(c)[later] = "effect/Array"
	seeded.intrinsics[later] = true
	if plan.collisionModules[later] != "" {
		t.Error("plan.collisionModules is the checker's live map")
	}
	if plan.intrinsics[later] {
		t.Error("plan.intrinsics is the checker's live map")
	}
}
