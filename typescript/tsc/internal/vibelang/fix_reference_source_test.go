package vibelang

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// referenceSourceFixture writes an unbuilt composite project core, whose
// service has an optional method, and a project app that references core and
// reaches the service through a guard, as a migrated Effect.fn handler does.
func referenceSourceFixture(t *testing.T) (string, *fixSys) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const n = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	writeProjectFiles(t, dir, map[string]string{
		"core/tsconfig.json": `{"compilerOptions":{"composite":true,"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"outDir":"out"},"files":["select.ts"]}`,
		"core/select.ts": `import { Context, Effect } from "effect"
export interface Interface {
  readonly resolve: () => Effect.Effect<string>
  readonly list?: () => Effect.Effect<number[]>
}
export class Service extends Context.Service<Service, Interface>()("Select") {}
`,
		"app/tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe"],"references":[{"path":"../core"}]}`,
		"app/main.vibe": `import { Effect } from "effect"
import { Service } from "../core/select.js"
export const shells = Effect.fn(function* () {
  const shell = yield* Service
  if (!shell.list) return yield* Effect.die(new Error("unavailable"))
  return yield* shell.list()
})
export const resolve = Effect.fn(function* () {
  const shell = yield* Service
  return yield* shell.resolve()
})
`,
	})
	return dir, &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
}

// anyBridge matches an Effect.try or Effect.tryPromise whose callback calls a
// member of the service the unbuilt reference declares.
var anyBridge = regexp.MustCompile(`Effect\.try(?:Promise)?\(\{\s*try:\s*(?:async\s*)?\(\)\s*=>[^}]*\bshell\.`)

// --fix builds no referenced project, so a reference's declaration output may
// not exist yet (TS6305), and an import resolved to it reads as any. The fix
// reads the reference's sources, as the editor does: the rewrite of a call into
// core is the one a built core gives, not the any boundary.
func TestFixReadsUnbuiltReferenceSources(t *testing.T) {
	for _, args := range [][]string{{"-p", "app/tsconfig.json"}, {"-b", "app/tsconfig.json"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			dir, sys := referenceSourceFixture(t)
			if status := FixWithOptions(t.Context(), sys, append(args, "--pretty", "false"), FixOptions{}); status != 0 {
				t.Fatalf("fix failed: %d\n%s\n%s", status, sys.stdout.String(), sys.stderr.String())
			}
			got := readProjectFile(t, dir, "app/main.vibe")
			for _, want := range []string{"return try shell.list()", "return try shell.resolve()"} {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q:\n%s", want, got)
				}
			}
			// The any boundary bridges the call into core; a defect bridge
			// around the handler's own new Error(...) is not about the reference.
			if anyBridge.MatchString(got) {
				t.Errorf("a call into the unbuilt reference was bridged as any:\n%s", got)
			}
			if _, err := os.Stat(filepath.Join(dir, "core", "out")); err == nil {
				t.Error("--fix wrote the reference's output")
			}
			if got := readProjectFile(t, dir, "core/select.ts"); !strings.Contains(got, "readonly list?:") {
				t.Errorf("the referenced project's source changed:\n%s", got)
			}
		})
	}
}
