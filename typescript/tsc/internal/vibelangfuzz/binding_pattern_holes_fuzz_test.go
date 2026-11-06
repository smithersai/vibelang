package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// A hole in an array pattern takes one iterator value and binds nothing, as
// ECMA-262 specifies, so a pattern with a hole compiles as the pattern with an
// unused name there does.
const bindingPatternHolesQuote = "fully evaluated as ECMA-262 specifies"

func TestBindingPatternHolesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), bindingPatternHolesQuote) {
		t.Fatal("chapter 2's evaluation order changed; review binding pattern holes")
	}
}

var bindingPatternHoleHosts = []string{
	"effect function f(xs: any) { for concurrent (const %s of xs) { } }",
	"effect function f(xs: any) { for concurrent (let %s of xs) { } }",
	"effect function f(xs: any) { for concurrent (2) (const %s of xs) { } }",
	"effect function f(xs: any) { const r = do { for (const %s of xs) { break; } 1; }; return r; }",
	"function f(xs: any) { const r = do { for (const %s of xs) { break; } 1; }; return r; }",
	"function f(p: any) { const r = do { const %s = p; if (p) { return 1; } 2; }; return r; }",
	"function f(p: any) { const %s = p; }",
	"effect function f(p: any) { const %s = p; }",
}

// bindingPatternHoleSource spells an array pattern from data. The twin writes
// a fresh name for every hole.
func bindingPatternHoleSource(data []byte) (hole, twin string) {
	at, fresh := 0, 0
	next := func() byte {
		if at >= len(data) {
			return 0
		}
		at++
		return data[at-1]
	}
	var pattern func(depth int) (string, string)
	pattern = func(depth int) (string, string) {
		var holes, twins []string
		count := 1 + int(next())%3
		for i := 0; i < count; i++ {
			fresh++
			name := fmt.Sprintf("v%d", fresh)
			switch choice := next() % 6; {
			case choice == 0 || choice == 1:
				holes, twins = append(holes, ""), append(twins, name)
			case choice == 2:
				holes, twins = append(holes, name), append(twins, name)
			case choice == 3:
				value := name + " = 1"
				holes, twins = append(holes, value), append(twins, value)
			case choice == 4:
				value := name + " = do { if (1) { 2; } 3; }"
				holes, twins = append(holes, value), append(twins, value)
			case depth < 2:
				a, b := pattern(depth + 1)
				holes, twins = append(holes, a), append(twins, b)
			default:
				holes, twins = append(holes, name), append(twins, name)
			}
		}
		left, right := strings.Join(holes, ", "), strings.Join(twins, ", ")
		// A trailing hole needs its own comma: [a, ] has one element.
		if holes[len(holes)-1] == "" {
			left += ","
		}
		return "[" + left + "]", "[" + right + "]"
	}
	return pattern(0)
}

func bindingPatternHoleCheck(t *testing.T, w *Workspace, data []byte) {
	t.Helper()
	if len(data) == 0 {
		t.Skip("no pattern")
	}
	hole, twin := bindingPatternHoleSource(data[1:])
	host := bindingPatternHoleHosts[int(data[0])%len(bindingPatternHoleHosts)]
	codes := func(source string) []string {
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, d := range result.Diagnostics {
			if IsEK(d) {
				out = append(out, fmt.Sprint(d.Code()))
			}
		}
		slices.Sort(out)
		return slices.Compact(out)
	}
	holes, twins := codes(fmt.Sprintf(host, hole)), codes(fmt.Sprintf(host, twin))
	if !slices.Equal(holes, twins) {
		t.Fatalf("a hole changed the diagnostics: %v, the named twin reports %v\n%s", holes, twins, fmt.Sprintf(host, hole))
	}
}

func TestBindingPatternHoles(t *testing.T) {
	w := NewWorkspace(t)
	for host := range bindingPatternHoleHosts {
		for _, pattern := range [][]byte{{0, 0, 0, 2}, {1, 0, 2}, {2, 5, 0, 0, 2, 0}, {0, 1}, {2, 2, 0, 3}, {1, 4, 1}} {
			bindingPatternHoleCheck(t, w, append([]byte{byte(host)}, pattern...))
		}
	}
}

func FuzzBindingPatternHoles(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	f.Add([]byte{0, 0, 0, 0, 2})
	f.Add([]byte{5, 2, 2, 0, 3})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 32 {
			t.Skip("bounded pattern")
		}
		bindingPatternHoleCheck(t, w, data)
	})
}
