package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowLocallyCaughtEffect(t *testing.T) {
	for _, source := range []string{
		"export function f(n:number):number!string {try{if(n)throw n;return Effect.succeed(n)}catch(e){return Effect.fail(String(e))}}",
		"export function f(xs:Iterable<number>):number!string {try{for(const n of xs){throw n};return Effect.succeed(0)}catch(e){return Effect.fail(String(e))}}",
	} {
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		fixed := result.Files[file.FileName()]
		if result.Err != nil || fixed == nil || len(result.Sites) != 0 || len(result.Changed) != 0 || !strings.Contains(fixed.Text, "$raise(") || strings.Contains(fixed.Text, "return die(") || strings.Contains(fixed.Text, "catch effect") {
			t.Fatalf("native caught exception must retain its catch/cleanup: %+v", result)
		}
	}
}

func TestFixNothrowCaughtBoundaryRefuses(t *testing.T) {
	for _, source := range []string{
		"export effect function f(){return Effect.fail(1) catch (e)=>{try{throw e}catch(x){return x}}}",

		"export function f(n:number):number!! {try{return Effect.succeed(n)}catch(e){throw e}}",
		"export function f():()=>number!! {try{return ():number!!=>{throw 1}}catch{return ()=>Effect.succeed(0)}}",
	} {
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		if result.Err != nil || len(result.Sites) == 0 || len(result.Changed) != 0 {
			t.Fatalf("missing escaping-throw refusal: %+v", result)
		}
		for _, fixed := range result.Files {
			if strings.Contains(fixed.Text, "$raise(") {
				t.Fatalf("catch cannot cross function/catch-body boundary: %s", fixed.Text)
			}
		}
	}
}
