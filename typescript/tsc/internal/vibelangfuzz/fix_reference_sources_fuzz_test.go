package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// referenceSourceShapes are the service members a migrated handler calls,
// keyed by the corpus key: each is the member's declaration and the
// Effect.fn body that reaches it.
var referenceSourceShapes = map[string][2]string{
	"required": {"readonly resolve: () => Effect.Effect<string>", "return yield* shell.resolve()"},
	"optional": {"readonly list?: () => Effect.Effect<number[]>", "if (!shell.list) return yield* Effect.die(new Error(\"unavailable\"))\n  return yield* shell.list()"},
	"union":    {"readonly list: (() => Effect.Effect<number[]>) | undefined", "if (shell.list === undefined) return 0\n  return yield* shell.list()"},
	"piped":    {"readonly update?: (patch: string) => Effect.Effect<void, Error>", "if (!shell.update) return yield* Effect.die(new Error(\"unavailable\"))\n  return yield* shell.update(\"p\").pipe(Effect.orDie)"},
	"function": {"readonly n: number", "return yield* lookup(shell.n)"},
}

// FuzzFixReferenceSources compares the compiler with itself on two inputs the
// chapter says must agree. "With `-b`, each project fixes its own files in
// build order": a project's fixes follow its references' sources, so a call
// into a referenced project that is not yet built is rewritten exactly as the
// same call into that module placed in the fixing project.
func FuzzFixReferenceSources(f *testing.F) {
	startShortBudget(f)
	checkBuildFixQuoted(f)
	w := NewWorkspace(f)
	f.Add("optional-p")
	var next int
	f.Fuzz(func(t *testing.T, key string) {
		shape, mode, _ := strings.Cut(key, "-")
		if _, ok := referenceSourceShapes[shape]; !ok {
			shape = "optional"
		}
		if mode != "b" {
			mode = "p"
		}
		key = shape + "-" + mode
		member, body := referenceSourceShapes[shape][0], referenceSourceShapes[shape][1]
		service := "import { Context, Effect } from \"effect\"\nexport interface Interface {\n  " + member + "\n}\n" +
			"export class Service extends Context.Service<Service, Interface>()(\"Select\") {}\n" +
			"export const lookup = (n: number): Effect.Effect<number> => Effect.succeed(n)\n"
		main := func(from string) string {
			return "import { Effect } from \"effect\"\nimport { Service, lookup } from \"" + from + "\"\n" +
				"export const handler = Effect.fn(function* () {\n  const shell = yield* Service\n  " + body + "\n})\n"
		}
		options := `"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]`
		next++
		dir := filepath.Join(w.Dir, "reference-sources-"+strconv.Itoa(next))
		files := map[string]string{
			"core/tsconfig.json":  `{"compilerOptions":{"composite":true,` + options + `,"outDir":"out"},"files":["select.ts"]}`,
			"core/select.ts":      service,
			"app/tsconfig.json":   `{"compilerOptions":{` + options + `,"noEmit":true},"files":["main.vibe"],"references":[{"path":"../core"}]}`,
			"app/main.vibe":       main("../core/select.js"),
			"local/tsconfig.json": `{"compilerOptions":{` + options + `,"noEmit":true},"files":["main.vibe","select.ts"]}`,
			"local/main.vibe":     main("./select.js"),
			"local/select.ts":     service,
		}
		for name, text := range files {
			path := filepath.Join(dir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		fixed := func(project string) string {
			t.Helper()
			sys := &sidecarParitySystem{fs: bundled.WrapFS(osvfs.FS()), cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir))}
			args := []string{"-" + mode, project + "/tsconfig.json", "--pretty", "false"}
			if project == "local" {
				args[0] = "-p"
			}
			if status := vibelang.FixWithOptions(t.Context(), sys, args, vibelang.FixOptions{}); status != 0 {
				Gap(t, "FuzzFixReferenceSources", key, "%s fix failed: %d %s", project, status, sys.output.String())
			}
			data, err := os.ReadFile(filepath.Join(dir, project, "main.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			return strings.Replace(string(data), "./select.js", "../core/select.js", 1)
		}
		local, across := fixed("local"), fixed("app")
		if across != local {
			Gap(t, "FuzzFixReferenceSources", key, "a call into the unbuilt reference is fixed differently:\nreference:\n%s\nlocal:\n%s", across, local)
		}
		if _, err := os.Stat(filepath.Join(dir, "core", "out")); err == nil {
			Gap(t, "FuzzFixReferenceSources", key, "--fix wrote the referenced project's output")
		}
		if data, err := os.ReadFile(filepath.Join(dir, "core", "select.ts")); err != nil || string(data) != service {
			Gap(t, "FuzzFixReferenceSources", key, "--fix edited the referenced project's source")
		}
		_ = os.RemoveAll(dir)
		ExpectPending(t, "FuzzFixReferenceSources", key)
	})
}
