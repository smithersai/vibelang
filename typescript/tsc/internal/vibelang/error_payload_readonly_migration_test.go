package vibelang

import (
	"strings"
	"testing"
)

func TestErrorPayloadReadonlyMigration(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, row := range []struct {
			name, body  string
			count       int
			want, avoid []string
		}{
			{"nested", "nested:{count:number;readonly fixed:string;mutable /* keep */ open:number}; values:{x:number}[];pair:[{y:number}]; callback:()=>{result:number}", 4, []string{"nested:{readonly count:", "readonly fixed:", "mutable /* keep */ open:", "values:{readonly x:", "pair:[{readonly y:", "()=>{readonly result:"}, []string{"readonly nested:", "readonly open:", "readonly readonly"}},
			{"comma fields", "left:{n:number}, right:{n:number},", 2, []string{"left:{readonly n:", "right:{readonly n:"}, nil},
			{"constructor field", "constructor:{n:number}; value:{n:number}", 2, []string{"constructor:{readonly n:", "value:{readonly n:"}, []string{"$", "construct0r"}},
			{"method types", "value:number; change(p:{n:number}):void {p.n=2}; make():{n:number} {return {n:1}}; local():void {const p:{n:number}={n:1};p.n=2}", 3, []string{"p:{readonly n:", "make():{readonly n:", "const p:{readonly n:"}, nil},
			{"index signatures", "dictionary:{[key:string]:{n:number}};open:{mutable /* keep */ [key:string]:number};fixed:{readonly [key:string]:number}", 2, []string{"dictionary:{readonly [key:string]:{readonly n:number}}", "mutable /* keep */ [key:string]", "readonly [key:string]"}, []string{"readonly mutable", "readonly readonly"}},
			{"key spellings and trivia", "value:{/* keep */ [Symbol.iterator]:()=>Iterator<number>; 'a-b'?:number; mutable?:boolean}", 3, []string{"/* keep */ readonly [Symbol.iterator]", "readonly 'a-b'?", "readonly mutable?"}, nil},
			{"explicit controls", "value:{readonly fixed:number;mutable open:number};ref:Payload;list:number[]", 0, []string{"readonly fixed:", "mutable open:"}, []string{"readonly value:", "readonly open:"}},
			{"nested declarations", "value:number; local():void { data P { V {value:{n:number}} }; schema Q {value:{n:number}}; error Inner {value:{n:number}} }", 1, []string{"data P { V {value:{n:number}} }", "schema Q {value:{n:number}}", "error Inner {value:{readonly n:number}}"}, nil},
		} {
			t.Run(form+"/"+row.name, func(t *testing.T) {
				source := "interface Payload {n:number}\nnamespace N {export " + form + " Problem { " + row.body + " }}\n"
				program, file, _, _ := editorProgram(t, source)
				p := errorPayloadReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
				if len(p.fixes) != row.count {
					t.Fatalf("got %d upgrades, want %d:\n%s", len(p.fixes), row.count, p.text())
				}
				fixed := p.text()
				for _, want := range row.want {
					if !strings.Contains(fixed, want) {
						t.Errorf("missing %q:\n%s", want, fixed)
					}
				}
				for _, avoid := range row.avoid {
					if strings.Contains(fixed, avoid) {
						t.Errorf("unexpected %q:\n%s", avoid, fixed)
					}
				}
				again, next, _, _ := editorProgram(t, fixed)
				if p := errorPayloadReadonlyMigrationFixes(t.Context(), again, next, map[string]bool{}); len(p.fixes) != 0 {
					t.Errorf("not idempotent:\n%s", p.text())
				}
				refused := map[string]bool{}
				for _, fix := range p.fixes {
					refused[fix.key] = true
				}
				if p := errorPayloadReadonlyMigrationFixes(t.Context(), program, file, refused); len(p.fixes) != 0 {
					t.Error("reoffered refused edits")
				}
			})
		}
	}
}
