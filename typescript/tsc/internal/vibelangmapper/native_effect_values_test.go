package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeEffectValuePrelude(t *testing.T) {
	for _, name := range []string{"interrupt", "yieldNow"} {
		for _, shape := range []string{"value", "alias", "shadow", "nested-shadow"} {
			t.Run(name+"/"+shape, func(t *testing.T) {
				source := "export const value = " + name
				switch shape {
				case "alias":
					source = "const selected = " + name + "; export const value = selected"
				case "shadow":
					source = "const " + name + " = 7; export const value = " + name
				case "nested-shadow":
					source = "export function local(" + name + ": number) { return " + name + " }; export const value = " + name
				}
				dir, stock := stockBuiltinProject(t)
				requireStockTypeScript(t, stock)
				projection := Project(source, testContext)
				if len(projection.Diagnostics) != 0 {
					t.Fatal(projection.Diagnostics)
				}
				contract := "import * as Native from \"effect/Effect\"; const contract: typeof Native." + name + " = value;"
				if shape == "shadow" {
					contract = "const contract: number = value;"
				}
				if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text+"\n"+contract), 0600); err != nil {
					t.Fatal(err)
				}
				cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
				cmd.Dir = dir
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("native type contract: %v\n%s\n%s", err, out, projection.Text)
				}
				js, _, diags := Emit(source, testContext)
				if len(diags) != 0 {
					t.Fatal(diags)
				}
				want := "E." + name
				if shape == "shadow" {
					want = "7"
				}
				cmd = exec.Command("node", "--input-type=module")
				cmd.Dir = dir
				cmd.Stdin = strings.NewReader(js + "\nimport * as E from 'effect/Effect'; console.log(value === " + want + ");")
				if out, err := cmd.CombinedOutput(); err != nil || strings.TrimSpace(string(out)) != "true" {
					t.Fatalf("native value identity: %v\n%s\n%s", err, out, js)
				}
			})
		}
	}
}
