package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func FuzzNothrowSuspendPreservation(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"statement", "tail", "nontail", "cleanup", "default", "shadow", "opencode-session-suspend"} {
		f.Add(key, int8(7))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, value int8) {
		TestNothrowPreservingQuoted(t)
		toolsGuard(t, "FuzzNothrowSuspendPreservation", func() {
			v := fmt.Sprint(value)
			refuse := false
			body := ""
			prefix := "export function main(n:number):number!! {return Effect.suspend("
			switch key {
			case "tail":
				body = "()=>n?throw " + v + ":Effect.succeed(n)"
			case "opencode-session-suspend":
				body = "()=>n?throw (\"Invalid cursor\" as const):Effect.succeed(n)"
			case "nontail":
				body = "()=>Effect.succeed(throw " + v + ")"
				refuse = true
			case "cleanup":
				body = "()=>{for(const x of xs){throw x};return Effect.succeed(n)}"
				refuse = true
			case "default":
				body = "(x=throw " + v + ")=>Effect.succeed(x)"
				refuse = true
			case "shadow":
				body = "()=>{const die=(x:unknown)=>Effect.fail(x);throw " + v + ";return Effect.succeed(n)}"
				refuse = true
			default:
				key = "statement"
				body = "()=>{if(n)throw " + v + ";return Effect.succeed(n)}"
			}
			source := "declare const xs:Iterable<number>;\n" + prefix + body + ")}"
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, "FuzzNothrowSuspendPreservation", files)
			defer before.Remove()
			r := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range r.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			for _, site := range r.Sites {
				if !vibelang.SiteHolds(source, fixed["main.vibe"], site) {
					Gap(t, "FuzzNothrowSuspendPreservation", key+":site", "refused site changed: %+v", site)
				}
			}
			if len(r.Changed) != 0 {
				Gap(t, "FuzzNothrowSuspendPreservation", key+":changed", "changed refused bytes: %+v", r.Changed)
			}
			if refuse {
				if len(r.Sites) == 0 {
					Gap(t, "FuzzNothrowSuspendPreservation", key, "missing preserving refusal")
				}
				return
			}
			if !strings.Contains(fixed["main.vibe"], "die(") || len(r.Sites) != 0 {
				Gap(t, "FuzzNothrowSuspendPreservation", key, "missing factory repair: %+v\n%s", r, fixed["main.vibe"])
			}
			after := toolsCompile(t, w, "FuzzNothrowSuspendPreservation", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, "FuzzNothrowSuspendPreservation", key+":errors", "fixed program has errors: %+v", after.Diagnostics)
			}
		})
	})
}
