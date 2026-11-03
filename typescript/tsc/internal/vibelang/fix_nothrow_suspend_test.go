package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowSuspend(t *testing.T) {
	for _, source := range []string{
		"export function main(n:number):number!! {return Effect.suspend(()=>{if(n)throw /*keep*/ n;return Effect.succeed(n)})}",
		"export function main(n:number):number!! {return Effect.suspend(()=>n?throw /*keep*/ n:Effect.succeed(n))}",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			r := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			fixed := r.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "die(") || !strings.Contains(fixed.Text, "/*keep*/") || len(r.Sites) != 0 {
				t.Fatalf("missing native-defect factory repair: %+v", r)
			}
		})
	}
}

func TestFixNothrowSuspendRefusesNonTailOrCleanup(t *testing.T) {
	for _, source := range []string{
		"export function main(xs:Iterable<number>):number!! {return Effect.suspend(()=>{for(const n of xs){throw n};return Effect.succeed(0)})}",
		"export function main():number!! {return Effect.suspend(()=>Effect.succeed(throw 1))}",
		"export function main():number!! {return Effect.suspend((n=throw 1)=>Effect.succeed(n))}",
		"export function main():number!! {return Effect.suspend(()=>{try{throw 1}finally{};return Effect.succeed(0)})}",
		"export function main():number!! {return Effect.suspend(function named(){throw 1;return Effect.succeed(0)})}",
		"export function main():number!! {return Effect.suspend(()=>{const die=(e:unknown)=>Effect.fail(e);throw 1;return Effect.succeed(0)})}",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			r := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			if len(r.Sites) == 0 {
				t.Fatalf("missing preserving refusal: %+v", r)
			}
			text := source
			if fixed := r.Files[file.FileName()]; fixed != nil {
				text = fixed.Text
			}
			for _, site := range r.Sites {
				if site.Code == "EK0401" && !SiteHolds(source, text, site) {
					t.Fatalf("refused site changed: %+v", site)
				}
			}
			if len(r.Changed) != 0 {
				t.Fatalf("changed refused bytes: %+v", r)
			}
		})
	}
}
