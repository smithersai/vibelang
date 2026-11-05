package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestForTryNativeIterationQuoted(t *testing.T) {
	forTryOperandsChapter(t)
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types.")
	chapterSays(t, "002-running.md", "Native \x60for...of\x60 and \x60for await\x60 keep TypeScript's protocol checks and JavaScript meaning")
}

func FuzzForTryNativeIteration(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, body, native string }{
		{"for-of", "for(const n of INPUT){void n}", "TS2488"},
		{"binding", "const [n]=INPUT;void n", "TS2488"},
		{"spread", "const values=[...INPUT];void values", "TS2488"},
		{"generator", "function* read(){yield* INPUT};void read", "TS2488"},
		{"for-await", "const read=async()=>{for await(const n of INPUT){void n}};void read", "TS2504"},
		{"async-generator", "async function* read(){yield* INPUT};void read", "TS2504"},
	}
	for _, row := range rows {
		for flags := uint8(0); flags < 16; flags++ {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestForTryNativeIterationQuoted(t)
		index := slices.IndexFunc(rows, func(row struct{ key, body, native string }) bool { return row.key == key })
		if index < 0 {
			index = 0
			for _, b := range []byte(key) {
				index = (index*31 + int(b)) % len(rows)
			}
		}
		row := rows[index]
		flags %= 16
		inner := "1"
		if flags&8 != 0 {
			inner = "[1]"
		}
		result := "Stream.make(1)"
		if flags&1 != 0 {
			result = "1"
		}
		operand := "(()=>{" + strings.ReplaceAll(row.body, "INPUT", inner) + ";return " + result + "})()"
		if flags&4 != 0 {
			operand = "(/* operand */ " + operand + ")"
		}
		kind := "effect "
		if flags&2 != 0 {
			kind = ""
		}
		source := "export " + kind + "function run(){for try(const value of " + operand + "){void value}}"
		resultCode, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer resultCode.Remove()
		got := r3Errors(resultCode.Diagnostics)
		var want []string
		if flags&2 != 0 {
			want = append(want, "EK2001")
		}
		if flags&1 != 0 {
			want = append(want, "EK2004")
		}
		if flags&8 == 0 {
			want = append(want, row.native)
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzForTryNativeIteration", fmt.Sprintf("%s:%d", row.key, flags), "native operand expressions retain their own iteration errors: want %v got %v\n%s", want, got, source)
		}
	})
}
