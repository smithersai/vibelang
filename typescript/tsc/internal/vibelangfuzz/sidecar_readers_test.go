package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// sidecarReadersQuote is the rule in docs/user/src/setup/vibelang-cli.md
// (foldkit-33: an app's main.vibe exporting Tabs.create<…>(), TS2883, failed
// although tsc compiles its TypeScript, which emits no declarations).
const sidecarReadersQuote = "What it still cannot print there, such as `TS4094`, is an error only where a `.ts` file of the project imports the module, as for the same TypeScript under `tsc`, since that file reads the sidecar: it is reported at that import."

// TestSidecarReaders checks each combination of a sidecar that cannot print
// an export (TS4094, a private member of an anonymous class), a project with
// or without declaration output, and its importers: none, a .ts file's
// import, import type, export from and import(), and a .vibe file's import,
// which reads the source, not the sidecar.
// Chapter 007 / unprintable sidecars report real errors only for required native importers: docs/design/src/007-tooling.md#9bc08ddb7ad676cc
// Chapter 007 / unprintable sidecars report real errors only for required native importers: docs/design/src/007-tooling.md#a3029ea720455c61

func TestSidecarReaders(t *testing.T) {
	text, err := os.ReadFile(filepath.Join(Root(), "docs/user/src/setup/vibelang-cli.md"))
	if err != nil || !strings.Contains(string(text), sidecarReadersQuote) {
		t.Fatalf("docs/user/src/setup/vibelang-cli.md no longer says %q; update the quote (%v)", sidecarReadersQuote, err)
	}
	w := NewWorkspace(t)
	importers := []struct{ name, file, text string }{
		{"import", "a.ts", `import { value } from "./main.vibe"` + "\nexport const a = value.read()\n"},
		{"import-type", "b.ts", `import type { Shape } from "./main.vibe"` + "\nexport type B = Shape\n"},
		{"export-from", "c.ts", `export { value } from "./main.vibe"` + "\n"},
		{"dynamic", "d.ts", "export const d = () => import(\"./main.vibe\")\n"},
		{"vibe", "e.vibe", `import { value } from "./main.vibe"` + "\nexport const e = value.read()\n"},
	}
	main := "export const value = new (class {\n  private hidden = 1\n  read() { return this.hidden }\n})()\nexport type Shape = typeof value\n"
	for mask := range 1 << len(importers) {
		for _, declaration := range []bool{false, true} {
			files := map[string]string{"main.vibe": main}
			var want []string
			for i, importer := range importers {
				if mask&(1<<i) == 0 {
					continue
				}
				files[importer.file] = importer.text
				if !declaration && importer.name != "vibe" {
					want = append(want, fmt.Sprintf("%s:%d", importer.file, strings.Index(importer.text, `"./main.vibe"`)))
				}
			}
			if declaration {
				want = []string{"main.vibe:" + fmt.Sprint(strings.Index(main, "value"))}
			}
			config := strings.Replace(DefaultConfig, `"declaration": true`, fmt.Sprintf(`"declaration": %v`, declaration), 1)
			names := make([]string, 0, len(files))
			for name := range files {
				names = append(names, name)
			}
			config = strings.TrimSuffix(config, "\n}") + fmt.Sprintf(",\n  \"files\": [%q", names[0])
			for _, name := range names[1:] {
				config += fmt.Sprintf(", %q", name)
			}
			config += "]\n}"
			t.Run(fmt.Sprintf("importers-%05b-declaration-%v", mask, declaration), func(t *testing.T) {
				r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
				if err != nil {
					t.Fatal(err)
				}
				defer r.Remove()
				var got []string
				sidecars := r.Program.EmitDeclarationSidecars(t.Context(), func(string, string) error { return nil })
				if sidecars != nil {
					for _, d := range sidecars.Diagnostics {
						if d.Code() != 4094 {
							t.Fatalf("unexpected sidecar diagnostic TS%d: %s", d.Code(), specDiagnosticText(d))
						}
						got = append(got, fmt.Sprintf("%s:%d", filepath.Base(string(d.File().FileName())), d.Pos()))
					}
				}
				slices.Sort(got)
				slices.Sort(want)
				if !slices.Equal(got, want) {
					t.Fatalf("sidecar diagnostics at %v, want %v\n%s", got, want, Archive(files))
				}
			})
		}
	}
}
