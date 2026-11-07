package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// writeProjectFiles writes each file of files under dir, making its directories.
func writeProjectFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, text := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// readProjectFile reads dir's file name, which must exist.
func readProjectFile(t *testing.T, dir, name string) string {
	t.Helper()
	text, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

// The selected project extends a base outside the repository, a base under
// node_modules and a base inside the repository, each holding the legacy
// severity map. Only the base inside the repository is migrated; each other
// one keeps its bytes and the run names it as not fixed.
func TestFixConfigTraversalStopsAtRepositoryBoundary(t *testing.T) {
	dir := onlyProject(t, map[string]string{"a.vibe": onlyFixableA})
	external := t.TempDir()
	legacy := "{\n  // keep\n  \"vibelang\": {\"diagnostics\": {\"EK4609\": \"off\"}}\n}\n"
	writeProjectFiles(t, external, map[string]string{"base.json": legacy})
	writeProjectFiles(t, dir, map[string]string{
		".jj/repo":                   "",
		"node_modules/cfg/base.json": legacy,
		"config/base.json":           legacy,
	})
	outside, err := filepath.Rel(dir, filepath.Join(external, "base.json"))
	if err != nil {
		t.Fatal(err)
	}
	writeProjectFiles(t, dir, map[string]string{
		"tsconfig.json": `{"extends":["` + filepath.ToSlash(outside) + `","./node_modules/cfg/base.json","./config/base.json"],"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe"]}`,
	})
	config := readProjectFile(t, dir, "tsconfig.json")
	status, sys := runFix(t, dir)
	if status != 0 {
		t.Fatalf("status %d\nstdout %s\nstderr %s", status, sys.stdout.String(), sys.stderr.String())
	}
	out := sys.stdout.String()
	// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#788fb321493e1069 | Config traversal stops at the repository boundary and `node_modules`; external configs are reported, never edited.
	// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation | Traverse `extends` only inside the repository and outside `node_modules`; report external configs without editing them.
	if got := readProjectFile(t, external, "base.json"); got != legacy {
		t.Errorf("the base outside the repository was edited:\n%s", got)
	}
	if got := readProjectFile(t, dir, "node_modules/cfg/base.json"); got != legacy {
		t.Errorf("the base under node_modules was edited:\n%s", got)
	}
	for _, name := range []string{"base.json: not fixed: config is outside repository ownership", "node_modules/cfg/base.json: not fixed: config is outside repository ownership"} {
		if !strings.Contains(out, name) {
			t.Errorf("the run does not report %q:\n%s", name, out)
		}
	}
	if got := readProjectFile(t, dir, "config/base.json"); got == legacy || !strings.Contains(got, `"severities"`) {
		t.Errorf("the base inside the repository was not migrated, so this test proves nothing:\n%s", got)
	}
	if got := readProjectFile(t, dir, "tsconfig.json"); got != config {
		t.Errorf("the selected config changed:\n%s", got)
	}
}

// A project holds a fixable owned source beside every kind of file chapter 7
// keeps from repair writes, each with text a .vibe repair would rewrite:
// dependencies (a package's declarations and a VibeLang source under
// node_modules that the project imports), a typeRoots package, foreign
// TypeScript and JavaScript of every extension, declarations including a
// VibeLang sidecar, emitted output, build info, lock files and a referenced
// project's own VibeLang source. Only the owned source changes.
func TestFixLeavesForeignAndGeneratedFiles(t *testing.T) {
	const effectText = "import { Effect } from \"effect\"\nexport type T = Effect.Effect<number>\nexport const one = Effect.succeed(1)\n"
	const fixable = "export type V = Effect.Effect<number>\n"
	dir := onlyProject(t, nil)
	writeProjectFiles(t, dir, map[string]string{
		"tsconfig.json":                 `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true,"allowJs":true,"jsx":"preserve","declaration":true,"outDir":"out","incremental":true,"tsBuildInfoFile":"cache/app.tsbuildinfo","typeRoots":["./types"],"types":["globals"]},"include":["*.vibe","*.ts","*.tsx","*.js","*.mjs","*.cjs"],"references":[{"path":"./lib"}]}`,
		"main.vibe":                     "import type { Dep } from \"dep\"\nimport type { Vendored } from \"./node_modules/dep/src.vibe\"\nimport type { T } from \"./native.ts\"\nexport type A = Effect.Effect<number>\nexport type D = [Dep, Vendored, T, GlobalT]\n",
		"native.ts":                     effectText,
		"view.tsx":                      effectText,
		"plain.js":                      effectText,
		"plain.mjs":                     effectText,
		"plain.cjs":                     "const { Effect } = require(\"effect\")\nmodule.exports = Effect.succeed(1)\n",
		"decl.d.ts":                     effectText,
		"old.d.vibe.ts":                 effectText,
		"types/globals/index.d.ts":      "declare type GlobalT = Effect.Effect<number>\n",
		"out/main.js":                   effectText,
		"out/main.d.ts":                 effectText,
		"cache/app.tsbuildinfo":         `{"version":"0.0.0","root":["../main.vibe"]}`,
		"package-lock.json":             `{"lockfileVersion":3,"packages":{}}`,
		"bun.lock":                      "{\n  \"lockfileVersion\": 1,\n}\n",
		"pnpm-lock.yaml":                "lockfileVersion: '9.0'\n",
		"lib/tsconfig.json":             `{"compilerOptions":{"composite":true,"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"outDir":"out"},"include":["*.vibe"]}`,
		"lib/src.vibe":                  fixable,
		"node_modules/dep/package.json": `{"name":"dep","version":"1.0.0","types":"./index.d.ts"}`,
		"node_modules/dep/index.d.ts":   "export type Dep = Effect.Effect<number>\n",
		"node_modules/dep/src.vibe":     "export type Vendored = Effect.Effect<number>\n",
	})
	dependencies := map[string]string{}
	for _, name := range []string{"node_modules/dep/package.json", "node_modules/dep/index.d.ts", "node_modules/dep/src.vibe"} {
		dependencies[name] = readProjectFile(t, dir, name)
	}
	before := projectBytes(t, dir)
	status, sys := runFix(t, dir)
	if status != 0 {
		t.Fatalf("status %d\nstdout %s\nstderr %s", status, sys.stdout.String(), sys.stderr.String())
	}
	after := projectBytes(t, dir)
	// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#c39fdb1d691c2d86 | Dependencies, `typeRoots`, bundled libs, foreign TypeScript/JavaScript, declarations, emitted output, build info, lock files and other referenced projects are excluded.
	// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation | | Dependencies, `typeRoots`, bundled libraries, foreign `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, declarations (`.d.ts`, `.d.vibe.ts`, `.d.vibex.ts`), emitted output, `tsBuildInfoFile`, lock files and other referenced projects | No repair writes.
	expectChanged(t, before, after, "main.vibe")
	for name, text := range dependencies {
		if got := readProjectFile(t, dir, name); got != text {
			t.Errorf("the dependency file %s changed:\n%s", name, got)
		}
	}
	if strings.Contains(after["main.vibe"], "Effect.Effect<number>") {
		t.Errorf("the owned source was not repaired, so this test proves nothing:\n%s", after["main.vibe"])
	}
}

// Four modules each hold one class of fix: a TypeScript-form teaching rewrite
// (EK4833), a prelude import cleanup, a migration of the retired await
// operation (EK1802) and the VIP-1 try migration of an effect arrow's body
// call. Ordinary --fix applies all but the VIP-1 pass; --fix-migration-only
// applies only the migration; --fix-vip-only applies the migration and the
// VIP-1 pass. Neither scope flag writes a teaching rewrite or cleans an import.
func TestFixScopeFlagsSelectPasses(t *testing.T) {
	const awaited = "effect function load(n: number) {\n  try Effect.yieldNowWith(0)\n  return { n }\n}\nexport effect function all() {\n  return await.all [load(4), load(5)]\n}\n"
	const migrated = "effect function load(n: number) {\n  try Effect.yieldNowWith(0)\n  return { n }\n}\nexport effect function all() {\n  return (try.all [effect { return try load(4) }, effect { return try load(5) }])\n}\n"
	const vip = "const authorize = <A, E>(operation: A!E): A!E => effect { return try operation }\nexport const direct = effect () => authorize(Effect.succeed(5))\n"
	const tried = "const authorize = <A, E>(operation: A!E): A!E => effect { return try operation }\nexport const direct = effect () => try authorize(Effect.succeed(5))\n"
	files := map[string]string{
		"teach.vibe":   "export type A = Effect.Effect<number>\n",
		"prelude.vibe": "import { Effect } from \"effect\"\nexport const one = Effect.succeed(1)\n",
		"await.vibe":   awaited,
		"vip.vibe":     vip,
	}
	for _, c := range []struct {
		name string
		args []string
		want []string
	}{
		{"ordinary", []string{"--fix"}, []string{"teach.vibe", "prelude.vibe", "await.vibe"}},
		{"migration", []string{"--fix", "--fix-migration-only"}, []string{"await.vibe"}},
		{"vip", []string{"--fix-vip-only", "--fix"}, []string{"await.vibe", "vip.vibe"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := onlyProject(t, files)
			before := projectBytes(t, dir)
			args, fix := FixArguments(c.args)
			if !fix {
				t.Fatalf("%v holds no --fix", c.args)
			}
			status, sys := runFix(t, dir, args...)
			if status != 0 {
				t.Fatalf("status %d\nstdout %s\nstderr %s", status, sys.stdout.String(), sys.stderr.String())
			}
			after := projectBytes(t, dir)
			// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#154f036bc6f3f655 | **Amended 2026-10-31: `--fix` scope flags.** Two flags scope a `vibelang --fix` invocation.
			// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#aa7610cec6aa9750 | `--fix-migration-only` selects migration fixes, excluding TypeScript-form teaching rewrites and prelude/import cleanup.
			// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#ca84885170cf9637 | `--fix-vip-only` selects the VIP migration passes, including the VIP-1/VIP-2 function-kind and `try` migration, excluding prelude/import cleanup.
			expectChanged(t, before, after, c.want...)
			if after["await.vibe"] != migrated {
				t.Errorf("await.vibe is\n%s\nwant\n%s", after["await.vibe"], migrated)
			}
			if slices.Contains(c.want, "vip.vibe") && after["vip.vibe"] != tried {
				t.Errorf("vip.vibe is\n%s\nwant\n%s", after["vip.vibe"], tried)
			}
		})
	}
}
