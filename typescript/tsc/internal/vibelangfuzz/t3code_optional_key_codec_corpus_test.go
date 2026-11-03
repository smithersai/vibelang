package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

type t3codeOptionalCodecFixture struct {
	Codec string
	Cases []struct {
		Key          string
		Source       string
		Control      string
		Expected2109 int
	}
}

func TestT3codeOptionalKeyCodecQuoted(t *testing.T) {
	b := string(rune(96))
	for _, quote := range []string{
		"Referenced schemas must preserve the source's decoded-key modifiers.",
		"A conflicting or unprovable flag is " + b + "EK2109" + b + ": use an unmodified value schema and write modifiers on the declaration.",
	} {
		if !strings.Contains(SpecText("006-data.md"), quote) {
			t.Fatalf("chapter006 no longer says %q", quote)
		}
	}
}

// The TypeScript controls retain optionalKey in the supplied codec.
// Required references reject with EK2109; optional source positions apply the
// schema mapping's normal wrappers. Native class/Struct controls establish
// admission before these archived programs exercise editor code-action safety.
func TestT3codeOptionalKeyCodecCorpus(t *testing.T) {
	TestT3codeOptionalKeyCodecQuoted(t)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-schema-optional-key-codec.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture t3codeOptionalCodecFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) != 8 {
		t.Fatalf("want eight retained neighbourhoods, got %d", len(fixture.Cases))
	}
	retained := map[string]bool{}
	for _, args := range CorpusInputs("FuzzEditor") {
		if len(args) > 0 {
			retained[toolsUnarchive(args[0])["main.vibe"]] = true
		}
	}
	w := NewWorkspace(t)
	seen := map[string]bool{}
	for _, row := range fixture.Cases {
		t.Run(row.Key, func(t *testing.T) {
			if seen[row.Key] || !retained[row.Source] {
				t.Fatal("duplicate or absent keyed editor witness")
			}
			seen[row.Key] = true
			for _, control := range []bool{true, false} {
				name, source, want := "main.vibe", row.Source, row.Expected2109
				if control {
					name, source, want = "main.ts", row.Control, 0
				}
				result, err := w.Compile(t.Context(), Project{Files: map[string]string{name: source, "codec.ts": fixture.Codec, "package.json": "{\"type\":\"module\"}"}})
				if err != nil {
					t.Fatal(err)
				}
				defer result.Remove()
				if result.SourceFile(name) == nil {
					t.Fatalf("control=%t project did not check %s", control, name)
				}
				got := 0
				for _, d := range result.Diagnostics {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == "EK" && d.Code() == 2109 {
						got++
						continue
					}
					t.Fatalf("control=%t unexpected diagnostic %v", control, Keys(result.Dir, result.Diagnostics))
				}
				if got != want {
					t.Fatalf("control=%t got%d EK2109, want%d: %v", control, got, want, Keys(result.Dir, result.Diagnostics))
				}
			}
		})
	}
}
