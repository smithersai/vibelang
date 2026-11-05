package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const forkObjectOperandQuote = "uses assignability to \x60Effect.Effect<any, any, any>\x60"

func TestForkObjectOperandsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), forkObjectOperandQuote) {
		t.Fatal(forkObjectOperandQuote)
	}
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
}
func FuzzForkObjectOperands(f *testing.F) {
	startShortBudget(f)
	keys := []string{"property", "empty", "shorthand", "computed", "spread", "getter", "method", "bad-method", "bad-getter"}
	for _, key := range keys {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, wrapped bool) {
		TestForkObjectOperandsQuoted(t)
		operands := map[string]string{"property": "{value:1}", "empty": "{}", "shorthand": "{value}", "computed": "{[name]:value}", "spread": "{...object}", "getter": "{get value(){return 1}}", "method": "{value(){return 1}}", "bad-method": "{value():number{return 'invalid'}}", "bad-getter": "{get value():number{return 'invalid'}}"}
		operand, ok := operands[key]
		if !ok {
			key = "property"
			operand = operands[key]
		}
		declarations := "const value=1;const name='item';const object={value:1};\n"
		for _, native := range []bool{true, false} {
			filename := "main.vibe"
			// Keep the Fiber local: this property checks operand admission.
			source := declarations + "export effect function probe(){const child = fork " + operand + ";void child;return 1}\n"
			want := []string{"EK1703"}
			if native {
				filename = "main.ts"
				source = declarations + "export const operand=" + operand + ";\n"
				want = nil
			} else if wrapped {
				source = declarations + "export effect function probe(){const child = fork Effect.succeed(" + operand + ");void child;return 1}\n"
				want = nil
			}
			if strings.HasPrefix(key, "bad-") {
				want = append(want, "TS2322")
			}
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{filename: source}})
			if err != nil {
				t.Fatal(err)
			}
			got := r3Errors(r.Diagnostics)
			r.Remove()
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				Gap(t, "FuzzForkObjectOperands", fmt.Sprintf("%s/native=%t/wrapped=%t", key, native, wrapped), "assignability owns operand rejection; embedded native errors remain: got %v, want %v\n%s", got, want, source)
			}
		}
	})
}
