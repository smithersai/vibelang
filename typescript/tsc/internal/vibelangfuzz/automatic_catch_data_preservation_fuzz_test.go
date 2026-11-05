package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestAutomaticCatchDataPreservationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output") {
		t.Fatal("automatic repair preservation authority changed")
	}
	TestCatchErrorDataAdvisoryQuoted(t)
}

func FuzzAutomaticCatchDataPreservation(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 4; shape++ {
		for kind := uint8(0); kind < 3; kind++ {
			f.Add(shape, kind, false)
			f.Add(shape, kind, true)
		}
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, shape, kind uint8, bad bool) {
		TestAutomaticCatchDataPreservationQuoted(t)
		const target = "FuzzAutomaticCatchDataPreservation"
		value := []string{"e", "Effect.succeed(e.id)", "e.id"}[kind%3]
		handler := []string{"(e)=>" + value, "(e)=>{return " + value + "}", "(e)=>(" + value + ")", "(e)=> /* keep data */ " + value}[shape%4]
		source := "error Absent {id:string}\neffect function failer(){throw new Absent({id:'lost'})}\nexport effect function run(){return failer() catch " + handler + "}\n"
		if bad {
			source += "export const invalid:string=1;\n"
		}
		files := map[string]string{"main.vibe": source}
		toolsGuard(t, target, func() {
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) != 0 {
				t.Fatal("invalid configuration")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v; refused: %v", result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if fixed["main.vibe"] != source {
				t.Fatalf("automatic repair changed returned data:\n%s", fixed["main.vibe"])
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			if !reflect.DeepEqual(SortedKeys(Keys(before.Dir, before.Diagnostics)), SortedKeys(Keys(after.Dir, after.Diagnostics))) {
				t.Fatal("automatic repair changed advisory or native error")
			}
			if !bad {
				if mismatch := toolsContractMismatch(t, w, before, after, false); mismatch != "" {
					t.Fatalf("contract changed: %s", mismatch)
				}
				was, is := node.Run(before, "out/main.js", "run"), node.Run(after, "out/main.js", "run")
				if toolsInvalidOutcome(was) || toolsInvalidOutcome(is) || was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					t.Fatalf("catch data Exit changed: before=%+v after=%+v", was, is)
				}
			}
		})
	})
}
