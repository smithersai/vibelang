package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Declaration boundaries must retain their own contract comments.
func TestDeclarationOrderExtraction(t *testing.T) {
	for _, value := range []uint8{0, 1, 2, 3, 15, 31, 63, 127, 255} {
		checkDeclarationOrderExtraction(t, value)
	}
	first := "/** @throws {never} */\nexport declare function first(): { value?: never };"
	second := "/** @throws {RangeError} */\nexport declare function second(): readonly number[];"
	for _, gap := range []string{"\n", "\r\n", "\n\n"} {
		forward := declarationsByFunction(first + gap + second)
		backward := declarationsByFunction(second + gap + first)
		for name, want := range map[string]string{"first": first, "second": second} {
			if forward[name] != want || backward[name] != want {
				t.Errorf("%s: got forward %q backward %q, want %q", name, forward[name], backward[name], want)
			}
		}
	}
	changed := strings.Replace(second, "RangeError", "TypeError", 1)
	if declarationsByFunction(second)["second"] == declarationsByFunction(changed)["second"] {
		t.Fatal("own throws contract change was ignored")
	}
	literal := "export declare function literal(): \"export declare function decoy(\";"
	got := declarationsByFunction(first + "\n" + literal)
	if len(got) != 2 || got["literal"] != literal {
		t.Errorf("literal created a false declaration: %v", got)
	}
	overloads := first + "\nexport declare function first(value:number):number;"
	if !strings.Contains(declarationsByFunction(overloads)["first"], first) {
		t.Fatal("earlier overload was discarded")
	}
}

func checkDeclarationOrderExtraction(t *testing.T, value uint8) {
	TestDeclarationOrderQuoted(t)
	var declarations []string
	for i := range 3 {
		tag := "never"
		if value&(1<<i) != 0 {
			tag = "RangeError"
		}
		newline := "\n"
		if value&8 != 0 {
			newline = "\r\n"
		}
		doc := "/** @throws {" + tag + "} */"
		if value&16 != 0 {
			doc = "/** example: export declare function decoy(" + newline + " * @throws {" + tag + "} */"
		}
		literal := "number"
		if value&32 != 0 {
			literal = "\"export declare function phantom(\""
		}
		declarations = append(declarations, doc+newline+fmt.Sprintf("export declare function f%d(): %s;", i, literal))
	}
	first := declarationsByFunction(strings.Join(declarations, "\n"))
	last := declarationsByFunction(declarations[2] + "\n" + declarations[1] + "\n" + declarations[0])
	if len(first) != 3 || len(last) != 3 {
		t.Fatalf("wrong function count: forward %v backward %v", first, last)
	}
	for i, want := range declarations {
		name := fmt.Sprintf("f%d", i)
		if first[name] != want || last[name] != want {
			t.Fatalf("%s got %q and %q, want %q", name, first[name], last[name], want)
		}
	}
}
