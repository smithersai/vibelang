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
		{"marker-unknown", "declare const input:{readonly \"~effect/Fiber\":unknown};", "input", true, false},
		{"marker-any", "declare const input:{readonly \"~effect/Fiber\":any};", "input", true, false},
		{"marker-never", "declare const input:{readonly \"~effect/Fiber\":never};", "input", true, false},
		{"marker-null", "declare const input:{readonly \"~effect/Fiber\":null};", "input", true, false},
		{"marker-string", "declare const input:{readonly \"~effect/Fiber\":string};", "input", true, false},
		{"marker-optional", "declare const input:{readonly \"~effect/Fiber\"?:unknown};", "input", true, false},
		{"marker-index", "declare const input:{readonly [key:string]:unknown;readonly \"~effect/Fiber\":unknown};", "input", true, false},
		{"marker-intersection", "declare const input:{readonly \"~effect/Fiber\":unknown}&{readonly id:number};", "input", true, false},
		{"marker-pick", "declare const input:Pick<Fiber.Fiber<number>,\"~effect/Fiber\">;", "input", true, false},
		{"marker-variance", "declare const input:{readonly \"~effect/Fiber\":{readonly _A:(_:never)=>number;readonly _E:(_:never)=>never}};", "input", true, false},
		{"marker-missing-id", "declare const input:Omit<Fiber.Fiber<number>,\"id\">;", "input", true, false},
		{"marker-optional-id", "declare const input:Omit<Fiber.Fiber<number>,\"id\">&{readonly id?:number};", "input", true, false},
		{"fiber-structural", "declare const input:Pick<Fiber.Fiber<number>,keyof Fiber.Fiber<number>>;", "input", false, false},
		{"fiber-intersection", "declare const input:Fiber.Fiber<number>&{readonly extra:string};", "input", false, false},
		{"fiber-error-alias", "type Handle=Fiber.Fiber<number,string>;declare const input:Handle;", "input", false, false},
		{"fiber-never-intersection", "declare const input:Fiber.Fiber<number>&never;", "input", false, false},
		{"null-literal", "", "null", true, true},
		{"undefined-literal", "", "undefined", true, true},
		{"void-expression", "", "void 0", true, true},
		{"null-type", "declare const input:null;", "input", true, true},
		{"undefined-type", "declare const input:undefined;", "input", true, true},
		{"null-alias", "type Input=null;declare const input:Input;", "input", true, true},
		{"undefined-alias", "type Input=undefined;declare const input:Input;", "input", true, true},
		{"void-type", "declare const input:void;", "input", true, false},
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
