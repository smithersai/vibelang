package vibelang

import (
	"strings"
	"testing"
)

func TestDataPayloadReadonlyMigration(t *testing.T) {
	for _, test := range []struct {
		name, source string
		count        int
		want         []string
		avoid        []string
	}{
		{
			"nested",
			"data P {V {nested:{count:number;readonly fixed:string;mutable open:number}; values:{x:number}[];pair:[{y:number}]; callback:()=>{result:number}}}\n",
			4,
			[]string{"nested:{readonly count:", "readonly fixed:", "mutable open:", "values:{readonly x:", "pair:[{readonly y:", "()=>{readonly result:"},
			[]string{"readonly nested:", "readonly values:", "readonly pair:", "readonly callback:", "readonly open:"},
		},
		{
			"generic and namespace",
			"namespace N {export data P<A> {V {value:{inner:A}|undefined}; Empty}}\n",
			1,
			[]string{"value:{readonly inner:A}"},
			[]string{"readonly value:"},
		},
		{
			"key spellings and comments",
			"data P {V {value:{/* keep */ [Symbol.iterator]:()=>Iterator<number>; 'a-b'?:number; mutable?:boolean}}}\n",
			3,
			[]string{"/* keep */ readonly [Symbol.iterator]", "readonly 'a-b'?", "readonly mutable?"},
			nil,
		},
		{
			"nested index signatures",
			"data P {V {dictionary:{[key:string]:{n:number}};open:{mutable [key:string]:number};fixed:{readonly [key:string]:number}}}\\n",
			2,
			[]string{"dictionary:{readonly [key:string]:{readonly n:number}}", "open:{mutable [key:string]", "fixed:{readonly [key:string]"},
			[]string{"readonly dictionary:", "readonly mutable", "readonly readonly"},
		},
		{
			"explicit mutable trivia and nested readonly",
			"data P {V {value:{mutable /* keep */ café:{n:number};readonly fixed:{n:number};mutable?:boolean}}}\n",
			3,
			[]string{"mutable /* keep */ café:{readonly n:number}", "readonly fixed:{readonly n:number}", "readonly mutable?"},
			[]string{"readonly café", "readonly readonly", "readonly value:"},
		},
		{
			"ordinary types and explicit modifiers",
			"interface Other {value:number}\ndata P {V {value:{readonly fixed:string;mutable open:number};ref:Other;list:number[]}}\n",
			0, []string{"interface Other {value:number}", "readonly fixed:", "mutable open:"}, nil,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			p := dataPayloadReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != test.count {
				t.Fatalf("got %d upgrades, want %d:\n%s", len(p.fixes), test.count, p.text())
			}
			fixed := p.text()
			for _, want := range test.want {
				if !strings.Contains(fixed, want) {
					t.Errorf("missing %q:\n%s", want, fixed)
				}
			}
			for _, avoid := range test.avoid {
				if strings.Contains(fixed, avoid) {
					t.Errorf("unexpected %q:\n%s", avoid, fixed)
				}
			}
			next, nextFile, _, _ := editorProgram(t, fixed)
			if again := dataPayloadReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) > 0 {
				t.Errorf("not idempotent:\n%s", again.text())
			}
			refused := map[string]bool{}
			for _, fix := range p.fixes {
				refused[fix.key] = true
			}
			if blocked := dataPayloadReadonlyMigrationFixes(t.Context(), program, file, refused); len(blocked.fixes) > 0 {
				t.Error("reoffered a refused edit")
			}
		})
	}
}
