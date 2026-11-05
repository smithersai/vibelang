package vibelangfuzz

import (
	_ "embed"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const throwCommaTypecheckTarget = "FuzzThrowCommaTypeChecking"
const throwCommaExitQuote = "`\"error\"` fails both `vibelang` and `vibelang lint`"

//go:embed testdata/corpus/t3code-throw-comma-independent-error.vibe
var throwCommaTypecheckWitness string

func TestThrowCommaTypeCheckingQuoted(t *testing.T) {
	r4Quoted(t, "007-tooling.md", throwCommaExitQuote)
	r4Quoted(t, grammarAppendix, estreeThrowWarningQuote)
	r4Quoted(t, "000-intro.md", "TypeScript's meaning outside Effect code.")
}

func throwCommaTypecheckProject(key string, mode uint8) Project {
	source := throwCommaTypecheckWitness
	if key != "witness" {
		expression := "{value:true?1:throw 2,tail:0}"
		prefix := ""
		if key == "array" {
			expression = "[throw 2,0]"
		}
		if key == "call" {
			prefix = "function g(value:unknown,tail:number){return value;}\n"
			expression = "g(throw 2,0)"
		}
		marker := "export const invalid:string=123;\n"
		function := "export effect function f(){return " + expression + ";}\n"
		if mode&2 != 0 {
			source = prefix + function + marker
		} else {
			source = prefix + marker + function
		}
	}
	if mode&1 != 0 {
		source = strings.ReplaceAll(source, "throw 2", "(throw 2)")
	}
	return Project{Files: map[string]string{"main.vibe": source}, Config: `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"ESNext","module":"ESNext","moduleResolution":"Bundler","noEmit":true,"types":[]},"files":["main.vibe"]}`}
}

func checkThrowCommaTypechecking(t *testing.T, w *Workspace, key string, mode uint8) {
	t.Helper()
	result, err := w.Compile(t.Context(), throwCommaTypecheckProject(key, mode))
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	error1010, type2322 := false, false
	for _, d := range result.Diagnostics {
		if d.Source() == "EK" && d.Code() == 1010 && d.Category() == diagnostics.CategoryError {
			error1010 = true
		}
		if d.Source() == "" && d.Code() == 2322 && d.Category() == diagnostics.CategoryError {
			type2322 = true
		}
	}
	good := error1010
	if mode&1 != 0 {
		good = type2322 && !error1010
	}
	if !good {
		Gap(t, throwCommaTypecheckTarget, fmt.Sprintf("%s/%d", key, mode&3), "Chapter 7: %q; Appendix A: %q; ungrouped invalid punctuators are errors, and grouping must expose the independent TypeScript assignment error; got %v\n%s", throwCommaExitQuote, estreeThrowWarningQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), Archive(throwCommaTypecheckProject(key, mode).Files))
	}
}

func TestThrowCommaIndependentTypeError(t *testing.T) {
	TestThrowCommaTypeCheckingQuoted(t)
	w := NewWorkspace(t)
	checkThrowCommaTypechecking(t, w, "witness", 0)
	checkThrowCommaTypechecking(t, w, "witness", 1)
}

func FuzzThrowCommaTypeChecking(f *testing.F) {
	startShortBudget(f)
	keys := []string{"witness", "object", "array", "call"}
	for _, key := range keys {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestThrowCommaTypeCheckingQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		checkThrowCommaTypechecking(t, w, key, mode&3)
	})
}
