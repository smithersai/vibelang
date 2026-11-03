package vibelang

import (
	"strings"
	"testing"
)

func TestNativeTypeReadonlyMigration(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		count        int
		want, avoid  []string
	}{
		{"smithers options", "export interface Options {cause?:unknown;name:string;readonly fixed:number};export type Shape={size:number}", 3, []string{"readonly cause?", "readonly name:", "readonly fixed:", "readonly size:"}, []string{"readonly readonly"}},
		{"methods and nested types", "interface I {read(input:{key:string}):{result:number};box:{inner:{value:number}}}", 5, []string{"read(input:{readonly key:", "{readonly result:", "readonly box:{readonly inner:{readonly value:"}, []string{"readonly read("}},
		{"indexer", "interface I {[key:string]:{value:number}}", 2, []string{"readonly [key:string]:{readonly value:"}, nil},
		{"mutable names and comments", "type T={mutable /*keep*/ open:number; mutable?:number; readonly fixed:{inner:number}}", 2, []string{"mutable /*keep*/ open:", "readonly mutable?:", "readonly fixed:{readonly inner:"}, []string{"readonly open:", "readonly readonly"}},
		{"mapped fields", "type T<A>={[K in keyof A]:{value:A[K]}}", 1, []string{"[K in keyof A]:{readonly value:"}, []string{"readonly [K"}},
		{"class fields", "export class Box {value=1;field:{inner:number}={inner:1}}", 1, []string{"field:{readonly inner:"}, []string{"readonly value", "readonly field:"}},
		{"native module", "module Native {export interface I {value:number}}\nimport {I} from Native\nexport type T={value:I}", 1, []string{"interface I {value:number}", "type T={readonly value:"}, nil},
		{"namespace", "export namespace N {export interface I {value:number}}", 1, []string{"interface I {readonly value:"}, nil},
		{"declaration payload owners", "data D {V {nested:{count:number}}}\nschema S={x:{value:number}}\nerror E {nested:{value:number}}", 0, nil, []string{"readonly "}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			p := nativeTypeReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != tc.count {
				t.Fatalf("got %d, want %d:\n%s", len(p.fixes), tc.count, p.text())
			}
			fixed := p.text()
			for _, part := range tc.want {
				if !strings.Contains(fixed, part) {
					t.Errorf("missing %q:\n%s", part, fixed)
				}
			}
			for _, part := range tc.avoid {
				if strings.Contains(fixed, part) {
					t.Errorf("unexpected %q:\n%s", part, fixed)
				}
			}
			next, nextFile, _, _ := editorProgram(t, fixed)
			if again := nativeTypeReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
				t.Errorf("not a fixed point:\n%s", again.text())
			}
			refused := map[string]bool{}
			for _, fix := range p.fixes {
				refused[fix.key] = true
			}
			if again := nativeTypeReadonlyMigrationFixes(t.Context(), program, file, refused); len(again.fixes) != 0 {
				t.Errorf("re-offered refused edits:\n%s", again.text())
			}
		})
	}
}
