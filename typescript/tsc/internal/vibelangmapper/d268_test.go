package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// An impure effect function keeps its Effect signature and has no direct marker.
func TestD268ImpureCallback(t *testing.T) {
	source := `export effect function noisy(n: number) { try Effect.log(n); return n }`
	for _, text := range []string{Project(source, testContext).Text, Executable(source, testContext).Text} {
		if strings.Contains(text, "noisy$direct") || strings.Contains(text, "namespace noisy") {
			t.Fatal(text)
		}
	}
}

// A bound explicit function name remains a binding, even when it is a keyword.
func TestRetryNamedFunctionBinding(t *testing.T) {
	source := `export function main() { const named = function async() { sleep("1 millis"); return async.name }; return named() }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v\n%s", projection.Diagnostics, projection.Text)
		}
		if !strings.Contains(projection.Text, "async") {
			t.Fatal(projection.Text)
		}
	}
}

// The acquisition lowers its method before Scope runs it; nested calls still run.
func TestStreamPullUsingMethods(t *testing.T) {
	source := `export function main() { using pull = Stream.range(1, 4).toPull(); return pull() }`
	for _, text := range []string{Project(source, testContext).Text, Executable(source, testContext).Text} {
		if strings.Contains(text, ").toPull()") || !strings.Contains(text, "Stream.toPull(") {
			t.Fatal(text)
		}
	}
}

func TestRetryBoundCallbackForm(t *testing.T) {
	source := `export function main() { const named = function async() { sleep("1 millis"); return async.name }; return Effect.forEach([1], named) }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v\n%s", projection.Diagnostics, projection.Text)
		}
	}
}

// Mapping an imported effect function creates cold Effects, and running
// those Effects still executes Effect.log and returns their values.
func TestD268ImpureImportRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	dir, err := os.MkdirTemp(scope, "d268-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	sources := map[string]string{
		"noisy.mjs":    `export effect function noisy(n: number) { try Effect.log("noisy"); return n * 2 }`,
		"consumer.mjs": `import { noisy } from "./noisy.mjs"; export effect function scenario() { const pending = [1, 2].map(noisy); const effects = pending.map((x) => Effect.isEffect(x)); const values = try Effect.all(pending); return { effects, values } }`,
	}
	for name, source := range sources {
		js, _, diagnostics := Emit(source, testContext)
		if len(diagnostics) != 0 {
			t.Fatalf("%v", diagnostics)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(js), 0600); err != nil {
			t.Fatal(err)
		}
	}
	entry := `import { Effect } from "effect"; import { scenario } from "./consumer.mjs"; console.log(JSON.stringify(await Effect.runPromise(scenario())))`
	cmd := exec.Command("node", "--input-type=module")
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(entry)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	if !strings.HasSuffix(strings.TrimSpace(string(out)), `{"effects":[true,true],"values":[2,4]}`) {
		t.Fatal(string(out))
	}
}

// Plain and effect function types cross named aliases, a re-export, and
// import-then-export.
func TestD268CrossFileTypes(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	dir := t.TempDir()
	dataMethodTestDependencies(t, root, dir, stock)
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"package.json": `{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`,
		"prelude.d.ts": string(prelude),
	}
	sources := map[string]string{
		"math.ts":   `function double(n: number) { return n * 2 }; export { double, double as twice }; export effect function noisy(n: number) { try Effect.log(n); return n }`,
		"barrel.ts": `export { twice as renamed } from "./math.js"; import { double as imported } from "./math.js"; export { imported as forwarded }`,
		"main.ts":   `import { renamed, forwarded } from "./barrel.js"; import { noisy } from "./math.js"; export function result() { return [...[1, 2].map(renamed), ...[1, 2].map(forwarded)] }; export function negative() { return [1, 2].map(noisy) }`,
	}
	for name, source := range sources {
		projection := Project(source, testContext)
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v", projection.Diagnostics)
		}
		files[name] = projection.Text
	}
	files["main.ts"] += `
import type { Effect as Program } from "effect/Effect";
const positive: number[] = result();
const negativeCheck: Program<number>[] = negative();
`
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s\n%s", err, out, files["math.ts"])
	}
}

// Exercise each reported acceptance case through the executable rendering.
func TestMapperFollowupRuntimeCases(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, name := range []string{"plain-export-lists", "plain-imports", "retry-effectful-predicate", "pipe-generic-stages", "contextual-effect-fields", "program-values", "pipe-asserted-program", "discarded-effect-call", "module-cycle-callback"} {
		t.Run(name, func(t *testing.T) {
			dir, err := os.MkdirTemp(scope, "mapper-followup-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			caseDir := filepath.Join(root, "typescript/vibelang/cases", name)
			files, err := filepath.Glob(filepath.Join(caseDir, "*.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			expected := ""
			for _, file := range files {
				source, err := os.ReadFile(file)
				if err != nil {
					t.Fatal(err)
				}
				if filepath.Base(file) == "main.vibe" {
					for _, line := range strings.Split(string(source), "\n") {
						if value, ok := strings.CutPrefix(line, "// expect-result:"); ok {
							expected = strings.TrimSpace(value)
						}
					}
				}
				checked := Project(string(source), testContext)
				if len(checked.Diagnostics) != 0 {
					t.Fatalf("%s: %v", file, checked.Diagnostics)
				}
				js, _, ds := Emit(string(source), testContext)
				if len(ds) != 0 {
					t.Fatalf("%s: %v", file, ds)
				}
				target := strings.TrimSuffix(filepath.Base(file), ".vibe") + ".js"
				if err := os.WriteFile(filepath.Join(dir, target), []byte(js), 0600); err != nil {
					t.Fatal(err)
				}
			}
			hatches, err := filepath.Glob(filepath.Join(caseDir, "*.ts"))
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range hatches {
				cmd := exec.Command("node", "--input-type=module", "-e", `import { stripTypeScriptTypes } from "node:module"; import { readFileSync, writeFileSync } from "node:fs"; writeFileSync(process.argv[2], stripTypeScriptTypes(readFileSync(process.argv[1], "utf8")))`, file, filepath.Join(dir, strings.TrimSuffix(filepath.Base(file), ".ts")+".js"))
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("%v: %s", err, out)
				}
			}
			if expected == "" {
				t.Fatal("missing expected result")
			}
			if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"type":"module"}`), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("node", "--input-type=module")
			cmd.Dir = dir
			// A case may log through Effect before it returns, so the result line
			// carries a marker, as the parity harness's runtime column does.
			const marker = "result: "
			cmd.Stdin = strings.NewReader(`import { Effect } from "effect"; import { main } from "./main.js"; console.log("` + marker + `" + JSON.stringify(await Effect.runPromise(main())))`)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("%v: %s", err, out)
			}
			got := ""
			for _, line := range strings.Split(string(out), "\n") {
				if value, ok := strings.CutPrefix(line, marker); ok {
					got = strings.TrimSpace(value)
				}
			}
			if got != expected {
				t.Fatalf("got %s; want %s", out, expected)
			}
		})
	}
}
