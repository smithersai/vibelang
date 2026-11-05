package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const inheritedErrorArityQuote = "Diagnostics from compiler-generated superclass calls do not accompany a rejected inheritance clause. Errors in user-written methods remain visible."

func TestInheritedErrorArityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), inheritedErrorArityQuote) {
		t.Fatal("missing inheritance diagnostic boundary")
	}
}
func checkInheritedErrorArity(t *testing.T, w *Workspace, key string, authored bool) {
	t.Helper()
	TestInheritedErrorArityQuoted(t)
	params := map[string]string{"zero": "", "one": "n:number", "two": "n:number,s:string", "optional": "n?:number", "rest": "...ns:number[]", "object": "fields:{note:string}"}
	param, ok := params[key]
	if !ok {
		key = "zero"
		param = params[key]
	}
	method := ""
	if authored {
		method = "method():number {return Math.imul(1)}"
	}
	source := fmt.Sprintf("class Base {readonly _tag:string='Base';constructor(%s){}}\nexport error Child extends Base {value:number;%s}\n", param, method)
	result := toolsCompile(t, w, "FuzzInheritedErrorConstructorArity", map[string]string{"main.vibe": source})
	defer result.Remove()
	inheritance, arity := 0, 0
	for _, d := range result.Diagnostics {
		if d.Category().Name() != "error" {
			continue
		}
		if IsEK(d) && d.Code() == 2117 {
			inheritance++
			continue
		}
		if d.Code() == 2554 && authored && d.Pos() >= strings.Index(source, "method():") {
			arity++
			continue
		}
		t.Fatalf("unexpected source diagnostic TS/EK%d [%d,%d): %v\n%s", d.Code(), d.Pos(), d.End(), d, source)
	}
	expected := 0
	if authored {
		expected = 1
	}
	if inheritance != 1 || arity != expected {
		t.Fatalf("inheritance=%d authored arity=%d, want 1/%d", inheritance, arity, expected)
	}
}
func TestInheritedErrorGeneratedArity(t *testing.T) {
	w := NewWorkspace(t)
	checkInheritedErrorArity(t, w, "zero", false)
	checkInheritedErrorArity(t, w, "zero", true)
}
func FuzzInheritedErrorConstructorArity(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"zero", "one", "two", "optional", "rest", "object"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, authored bool) {
		toolsGuard(t, "FuzzInheritedErrorConstructorArity", func() { checkInheritedErrorArity(t, w, key, authored) })
	})
}
