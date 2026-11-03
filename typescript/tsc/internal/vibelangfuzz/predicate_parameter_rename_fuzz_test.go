package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Native TypeScript's parameter binding is unchanged by the predicate's
// spelling. Exercise prefix offsets and name lengths that must not influence
// file-relative reference/rename positions (VIP-34's TypeScript editor).
func FuzzPredicateParameterRename(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"is", "instanceof"} {
		f.Add(key, byte(0), byte(0))
		f.Add(key, byte(17), byte(2))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, prefix, length byte) {
		op := "is"
		if key == "instanceof" {
			op = key
		}
		name := "parameter" + strings.Repeat("x", int(length)%32)
		source := fmt.Sprintf("error E\n%s\nexport function pick(){return (%s:unknown)=>%s %s E}", strings.Repeat("// padding\n", int(prefix)%8), name, name, op)
		files := map[string]string{"main.vibe": source}
		r := toolsCompile(t, w, consistencyTarget, files)
		defer r.Remove()
		c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
		c.before = c.project(r, files)
		for _, symbol := range c.symbols() {
			if symbol.name == name && symbol.kind == "Parameter" && len(symbol.refs) > 0 {
				probe := consistencyProbe{consistencySymbol: symbol, consistencyRef: symbol.refs[0]}
				refs := c.checkReferences(probe)
				if refs == nil {
					t.Fatal("parameter has no references")
				}
				c.checkRename(probe, refs)
				return
			}
		}
		t.Fatal("parameter was not probed")
	})
}

const predicateParameterQuote = "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |"

func TestPredicateParameterRenameQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), predicateParameterQuote) {
		t.Fatal("TypeScript plain-function rule changed")
	}
}
