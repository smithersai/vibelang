package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestStockProjectionGoldens pins D31, D4 service context, and D132's
// omitted operation bindings in both renderings, then checks stock tsc.
func TestStockProjectionGoldens(t *testing.T) {
	cases := map[string]string{
		"imports": `import { name } from "./names.ts"; export { name } from "./names.ts"; export function value() { return name }`,
		"service": `import { Effect } from "effect"; service Names { lookup(id: number): Effect<string, never, never> } export const live = Layer.succeed(Names, { lookup(id) { return String(id) } })`,
		"handler": `control Log { write(message: string, level?: string): void!! } export function scenario() { try { Log.write("x"); return 42 } handle Log.write(message) { resume() } }`,
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			dir, stock := stockBuiltinProject(t)
			requireStockTypeScript(t, stock)
			for rendering, projection := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
				if len(projection.Diagnostics) != 0 {
					t.Fatalf("%s: %v", rendering, projection.Diagnostics)
				}
				golden := filepath.Join("testdata", "stock", name+"."+rendering+".ts")
				if os.Getenv("UPDATE_STOCK_GOLDENS") == "1" {
					if err := os.MkdirAll(filepath.Dir(golden), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(golden, []byte(projection.Text), 0644); err != nil {
						t.Fatal(err)
					}
				}
				want, err := os.ReadFile(golden)
				if err != nil {
					t.Fatal(err)
				}
				if projection.Text != string(want) {
					t.Fatalf("%s golden differs:\n%s", rendering, projection.Text)
				}
				if rendering == "checking" {
					if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := os.WriteFile(filepath.Join(dir, "names.ts"), []byte(`export const name = "Ada"`), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--target", "es2022", "--module", "nodenext", "main.ts")
			cmd.Dir = dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			if name == "handler" {
				js, _, diagnostics := Emit(source, testContext)
				if len(diagnostics) != 0 {
					t.Fatal(diagnostics)
				}
				cmd := exec.Command("node", "--no-warnings", "--input-type=module")
				cmd.Dir = dir
				cmd.Stdin = strings.NewReader(js + "\nimport { runPromise } from \"effect/Effect\"; console.log(await runPromise(scenario()))")
				if out, err := cmd.CombinedOutput(); err != nil || strings.TrimSpace(string(out)) != "42" {
					t.Fatalf("%v\n%s", err, out)
				}
			}
		})
	}
}
