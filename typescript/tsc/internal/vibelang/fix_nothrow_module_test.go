package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowModuleKeepsCapture(t *testing.T) {
	source := "let secret = 1; export function f(): number { throw secret }"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, "$raise(secret)") || len(result.Sites) != 0 {
		t.Fatalf("want captured operand evaluated at its original site: %+v", result)
	}
}

func TestFixNothrowThrowBridge(t *testing.T) {
	for _, source := range []string{
		"error Bad\nexport function f(n:number):number { if(n<0) throw new Bad(); return n }",
		"let n=0; export function f():number { try { throw ++n } catch(e) { return n } }",
		"export function f(n:number):number { if(n<0) throw /*keep*/ n; if(n>10) throw n+1; return n }",
		"effect function load():number!string {throw \"x\"}\nexport effect function f() { return (load() catch (e)=>{throw e}) }",
		"error Bad\nexport const f=(n:number):number => n || throw new Bad()",
		"error Bad\nexport function f(n=throw new Bad()):number {return n}",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Sites) != 0 || (!strings.Contains(fixed.Text, "$raise(") && !strings.Contains(fixed.Text, "catch effect")) {
				t.Fatalf("want preserving TS throw: %+v", result)
			}
			if strings.Contains(source, "/*keep*/") && !strings.Contains(fixed.Text, "/*keep*/") {
				t.Fatal("lost comment")
			}
			if !strings.Contains(source, "catch (e)") && strings.Count(fixed.Text, nothrowRaiseBody) != 1 {
				t.Fatalf("must reuse one bridge: %s", fixed.Text)
			}
		})
	}
}

func TestFixNothrowLeavesRefusedOperand(t *testing.T) {
	source := "export function* f(s: string): Generator<string, never, string> { throw JSON.parse(yield s) }"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || !strings.Contains(fixed.Text, "$raise(JSON.parse(yield s))") {
		t.Fatalf("independent throw repair missing: %+v", result)
	}
	for _, site := range result.Sites {
		if !SiteHolds(source, fixed.Text, site) {
			t.Fatalf("refused site changed: %+v", site)
		}
	}
	if len(result.Sites) == 0 || len(result.Changed) != 0 {
		t.Fatalf("want an unchanged per-site refusal: %+v", result)
	}
}
