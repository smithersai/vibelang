package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestTryLiteralContextsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "an operand that is not an array of Effects, using assignability to \x60ReadonlyArray<Effect.Effect<any, any, any>>\x60")
	chapterSays(t, "007-tooling.md", "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types.")
}

func FuzzTryLiteralContexts(f *testing.F) {
	startShortBudget(f)
	rows := []struct {
		key, operand, code string
		valid              bool
	}{
		{"property", "({value:\"bad\"} satisfies {value:number})", "TS2322", false},
		{"excess", "({extra:1} satisfies {value:number})", "TS2353", false},
		{"array", "([\"bad\"] satisfies number[])", "TS2322", false},
		{"nested-array", "([{value:\"bad\"}] satisfies {value:number}[])", "TS2322", false},
		{"tuple", "([\"bad\"] satisfies [number])", "TS2322", false},
		{"body", "({value:(()=>{const n:number=\"bad\";return n})()} satisfies {value:number})", "TS2322", false},
		{"raw-property", "({value:1})", "", false},
		{"valid", "([Effect.succeed(7)] satisfies ReadonlyArray<Effect.Effect<number>>)", "", true},
	}
	ops := []string{"all", "race", "any", "allSettled"}
	for _, op := range ops {
		for _, row := range rows {
			for flags := uint8(0); flags < 2; flags++ {
				f.Add(op+":"+row.key, flags)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestTryLiteralContextsQuoted(t)
		op, rowKey, _ := strings.Cut(key, ":")
		if !slices.Contains(ops, op) {
			op = ops[len(key)%len(ops)]
		}
		index := slices.IndexFunc(rows, func(r struct {
			key, operand, code string
			valid              bool
		}) bool {
			return r.key == rowKey
		})
		if index < 0 {
			index = 0
			for _, b := range []byte(key) {
				index = (index*31 + int(b)) % len(rows)
			}
		}
		row := rows[index]
		operand := row.operand
		if flags&1 != 0 {
			operand = "(/* operand */ " + operand + ")"
		}
		result, err := w.Compile(t.Context(), Single("export effect function run(){return try."+op+" "+operand+"}"))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		want := []string{}
		if !row.valid {
			want = append(want, "EK1801")
		}
		if row.code != "" {
			want = append(want, row.code)
		}
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzTryLiteralContexts", fmt.Sprintf("%s:%d", key, flags%2), "chapter 7 retains source checks: want %v got %v", want, got)
		}
	})
}
