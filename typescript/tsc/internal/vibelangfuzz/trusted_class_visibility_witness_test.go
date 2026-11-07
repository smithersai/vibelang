package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const trustedVisibilityInventoryQuote = "A transitional compiler may still print compatibility diagnostics from the old language."

func TestTrustedClassVisibilityWitnessQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), trustedVisibilityInventoryQuote) {
		t.Fatal("missing compatibility inventory rule")
	}
}

func FuzzTrustedClassVisibilityWitness(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"direct", "alias", "namespace", "unicode"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, exported bool) {
		TestTrustedClassVisibilityWitnessQuoted(t)
		name := "Hidden"
		if key == "unicode" {
			name = "隠れた"
		}
		visibility := ""
		if exported {
			visibility = "export "
		}
		foreign := "import { trusted } from \"vibelang-runtime\"\n" + visibility + "class " + name + " extends Error { readonly _tag=\"Hidden\"; private readonly brand=true; constructor(message:string){super(message)} }\nexport const read=trusted((value=0):number=>{if(value)throw new " + name + "(\"hidden\");return 7},[" + name + "])\n"
		imp, call := "import {read} from \"./foreign.js\"", "read(0)"
		if key == "alias" {
			imp, call = "import {read as invoke} from \"./foreign.js\"", "invoke(0)"
		}
		if key == "namespace" {
			imp, call = "import * as foreign from \"./foreign.js\"", "foreign.read(0)"
		}
		source := imp + "\nexport effect function main(): number! Error { return " + call + " }\n"
		project := Project{Files: map[string]string{"main.vibe": source, "foreign.ts": foreign}}
		c, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Remove()
		found := 0
		for _, d := range c.Diagnostics {
			if IsEK(d) && d.Code() == 4401 {
				found++
				if d.Category() != diagnostics.CategoryError {
					t.Fatal(d.String())
				}
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("unexpected error: %s", d.String())
			}
		}
		want := 1
		if exported {
			want = 0
		}
		if found != want {
			t.Fatalf("%s/exported=%v: got %d EK4401 want %d", key, exported, found, want)
		}
		native := Project{Files: map[string]string{"main.ts": "import { " + name + " } from \"./foreign.ts\"; export const kind = typeof " + name + ";\n", "foreign.ts": foreign, "package.json": "{\"type\":\"module\"}"}, Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[],"allowImportingTsExtensions":true},"files":["main.ts","foreign.ts"]}`}
		n, err := w.Compile(t.Context(), native)
		if err != nil {
			t.Fatal(err)
		}
		defer n.Remove()
		spans, _, err := stockSpans(t.Context(), tsc, n.Dir, "main.ts", "foreign.ts")
		if err != nil {
			t.Fatal(err)
		}
		stockWant := 1
		if exported {
			stockWant = 0
		}
		stockFound := 0
		for _, d := range spans {
			if d.Code == 2459 {
				stockFound++
				continue
			}
			if d.Category == "error" {
				t.Fatalf("unexpected stock diagnostic: %s", d)
			}
		}
		if stockFound != stockWant {
			t.Fatalf("stock export visibility: got %v want TS2459 count %d", spans, stockWant)
		}
		t.Logf("%s/exported=%v: compatibility EK4401=%d, stock TS2459=%d", key, exported, found, stockFound)
	})
}
