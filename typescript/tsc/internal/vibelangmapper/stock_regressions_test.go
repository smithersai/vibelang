package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestStockProjectionGoldens pins D31 imports and D4 service context in
// both renderings, then checks stock tsc. The checking rendering keeps a
// relative ./x.ts import as written, so stock tsc allows .ts import paths.
func TestStockProjectionGoldens(t *testing.T) {
	cases := map[string]string{
		"imports": `import { name } from "./names.ts"; export { name } from "./names.ts"; export function value() { return name }`,
		"service": `import { Effect } from "effect"; service Names { lookup(id: number): Effect<string, never, never> } export const live = Layer.succeed(Names, { effect lookup(id) { return String(id) } })`,
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			// Compare goldens before the stock-compiler skip: the comparison
			// needs no compiler (#597).
			checking := ""
			rewritten := false
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
					rewritten = true
					continue
				}
				want, err := os.ReadFile(golden)
				if err != nil {
					t.Fatal(err)
				}
				if projection.Text != string(want) {
					t.Fatalf("%s golden differs:\n%s", rendering, projection.Text)
				}
				if rendering == "checking" {
					checking = projection.Text
				}
			}
			// A rewritten golden would compare equal to itself, so the run
			// cannot pass.
			if rewritten {
				t.Fatal("goldens rewritten; rerun without UPDATE_STOCK_GOLDENS")
			}
			dir, stock := stockBuiltinProject(t)
			requireStockTypeScript(t, stock)
			if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(checking), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "names.ts"), []byte(`export const name = "Ada"`), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--allowImportingTsExtensions", "--target", "es2022", "--module", "nodenext", "main.ts")
			cmd.Dir = dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
		})
	}
}
