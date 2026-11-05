package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMapperErrorRegistrationMembersQuoted(t *testing.T) {
	const quote = "`error Name { fields }` declares exactly Effect's `Data.TaggedError` class."
	if !strings.Contains(SpecText("003-failures.md"), quote) {
		t.Fatal("error class meaning changed")
	}
}
func FuzzMapperErrorRegistrationMembers(f *testing.F) {
	startShortBudget(f)
	keys := []string{"bare", "empty", "field", "getter", "method", "comma", "abstract", "schema", "unicode"}
	for _, key := range keys {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	prelude, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/prelude.d.ts"))
	if err != nil {
		f.Fatal(err)
	}
	pkg, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/package.json"))
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestMapperErrorRegistrationMembersQuoted(t)
		declaration := "export error Sample { value:number }"
		switch key {
		case "bare":
			declaration = "export error Sample"
		case "empty":
			declaration = "export error Sample {}"
		case "getter":
			declaration = "export error Sample {value:number;get label():number{return this.value}}"
		case "method":
			declaration = "export error Sample {value:number;label():number{return this.value}}"
		case "comma":
			declaration = "export error Sample {id:string,count:number}"
		case "abstract":
			declaration = "export abstract error Sample {value:number}"
		case "schema":
			declaration = "export schema error Sample {value:number}"
		case "unicode":
			declaration = "export error 問題 {値:string}"
		}
		source := "// λ\nexport const events:number[]=[];export class NativeControl {static {events.push(7)}}\n" + declaration + "\n"
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		for name, p := range map[string]vibelangmapper.Projection{"checking": vibelangmapper.Project(source, vibelangmapper.FileContext{}), "executable": vibelangmapper.Executable(source, vibelangmapper.FileContext{})} {
			if len(p.Diagnostics) != 0 {
				t.Fatalf("%s/%s: %v", key, name, p.Diagnostics)
			}
			files := map[string]string{"main.ts": p.Text, "package.json": "{\"type\":\"module\"}", "node_modules/vibelang-ts-mapper/prelude.d.ts": string(prelude), "node_modules/vibelang-ts-mapper/package.json": string(pkg)}
			c, err := w.Compile(t.Context(), Project{Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			for _, d := range c.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("%s/%s native: %s\n%s", key, name, d.String(), p.Text)
				}
			}
			spans, _, err := stockSpans(t.Context(), tsc, c.Dir, "main.ts")
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range spans {
				if d.Category == "error" {
					t.Fatalf("%s/%s stock: %s\n%s", key, name, d, p.Text)
				}
			}
		}
	})
}
