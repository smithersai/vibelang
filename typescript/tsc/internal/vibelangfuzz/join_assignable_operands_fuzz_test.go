package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"
)

func TestJoinAssignableOperandsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "a \x60join\x60 operand not assignable to \x60Fiber.Fiber<any, any>\x60")
	chapterSays(t, "002-running.md", "\x60never\x60 and \x60any\x60 pass this test")
}

// TypeScript assigns both any and never to the Fiber operand domain.
// Never inputs are static only; no runtime witness attempts to produce one.
func FuzzJoinAssignableOperands(f *testing.F) {
	startShortBudget(f)
	rows := []struct {
		key, decl, operand string
		reject, nullable   bool
	}{
		{"any", "declare const input:any;", "input", false, false},
		{"any-alias", "type Input=any;declare const input:Input;", "input", false, false},
		{"any-union", "declare const input:any|undefined;", "input", false, false},
		{"never", "declare function impossible():never;", "impossible()", false, false},
		{"never-alias", "type Empty=never;declare function impossible():Empty;", "impossible()", false, false},
		{"never-generic", "type Empty<T>=T&never;declare function impossible():Empty<number>;", "impossible()", false, false},
		{"fiber", "declare const input:Fiber.Fiber<number>;", "input", false, false},
		{"unknown", "declare const input:unknown;", "input", true, false},
		{"number", "declare const input:number;", "input", true, false},
		{"nullable", "declare const input:Fiber.Fiber<number>|undefined;", "input", true, true},
	}
	for _, row := range rows {
		for flags := uint8(0); flags < 4; flags++ {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestJoinAssignableOperandsQuoted(t)
		index := slices.IndexFunc(rows, func(r struct {
			key, decl, operand string
			reject, nullable   bool
		}) bool {
			return r.key == key
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
		strict := flags&2 == 0
		var config map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
			t.Fatal(err)
		}
		config["compilerOptions"].(map[string]any)["strictNullChecks"] = strict
		raw, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": row.decl + "\nexport effect function run(){return join " + operand + "}"}, Config: string(raw)})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		want := []string{}
		if row.reject && (!row.nullable || strict) {
			want = append(want, "EK1704")
		}
		if !slices.Equal(got, want) {
			Gap(t, "FuzzJoinAssignableOperands", fmt.Sprintf("%s:%d", row.key, flags%4), "TypeScript assignability wants %v got %v", want, got)
		}
	})
}
