package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const fiberPlacementIndependentTarget = "FuzzFiberPlacementIndependent"

func TestFiberPlacementIndependentQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"002-running.md": "| \x60fork\x60 or \x60join\x60 outside effect code | \x60EK1701\x60 |",
		"007-tooling.md": "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types.",
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// Placement owns the generated helper error. Source calls in that operand
// still receive TypeScript's checks at every nonexecuting source boundary.
func FuzzFiberPlacementIndependent(f *testing.F) {
	startShortBudget(f)
	rules := []struct {
		key, decl, operand string
		native             int32
	}{
		{"argument", "declare function take(n:number):number;", "take(\"bad\")", 2345},
		{"overload", "declare function take(n:number):number;declare function take(n:boolean):number;", "take(\"bad\")", 2769},
		{"constraint", "declare function take<T extends number>(n:T):number;", "take<string>(\"bad\")", 2344},
		{"property", "declare function take(n:{value:number}):number;", "take({value:\"bad\"})", 2322},
		{"satisfies", "declare function take(n:number):number;", "take(1 satisfies string)", 1360},
		{"valid", "declare function take(n:number):number;", "take(1)", 0},
	}
	boundaries := []struct{ key, source string }{
		{"plain", "function run(){return %s}"},
		{"async", "async function run(){return %s}"},
		{"default", "effect function run(x = %s){return 1}"},
		{"static", "effect function run(){class C {static {const x = %s}}return 1}"},
		{"callback", "effect function run(){return [1].map(()=>%s)}"},
	}
	for _, op := range []string{"fork", "join"} {
		for _, boundary := range boundaries {
			for _, row := range rules {
				for wrap := uint8(0); wrap < 2; wrap++ {
					f.Add(op+":"+boundary.key+":"+row.key, wrap)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, wrap uint8) {
		TestFiberPlacementIndependentQuoted(t)
		parts := strings.Split(key, ":")
		op := "fork"
		bi, ri := -1, -1
		if len(parts) == 3 {
			op = parts[0]
			bi = slices.IndexFunc(boundaries, func(b struct{ key, source string }) bool { return b.key == parts[1] })
			ri = slices.IndexFunc(rules, func(r struct {
				key, decl, operand string
				native             int32
			}) bool {
				return r.key == parts[2]
			})
		}
		if (op != "fork" && op != "join") || bi < 0 || ri < 0 {
			index := 0
			for _, b := range []byte(key) {
				index = (index*31 + int(b)) % 600
			}
			op = []string{"fork", "join"}[index%2]
			bi = (index / 2) % len(boundaries)
			ri = (index / 10) % len(rules)
		}
		rule := rules[ri]
		operand := rule.operand
		if wrap%2 != 0 {
			open := strings.Index(operand, "(")
			close := strings.LastIndex(operand, ")")
			operand = operand[:open+1] + "(/* argument */ " + operand[open+1:close] + ")" + operand[close:]
		}
		source := rule.decl + "\n" + fmt.Sprintf(boundaries[bi].source, op+" "+operand)
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := []int32{}
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, d.Code())
			}
		}
		want := []int32{1701}
		if rule.native != 0 {
			want = append(want, rule.native)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, fiberPlacementIndependentTarget, fmt.Sprintf("%s:%d", key, wrap%2), "want %v got %v\n%s", want, got, source)
		}
	})
}
