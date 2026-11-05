package vibelangfuzz

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperCatchFixtureOwnersQuoted(t *testing.T) {
	TestCatchBoundaryIdentityQuoted(t)
	chapterSays(t, "001-functions.md", "a plain arrow written inside an `effect` function is a plain function")
}

func FuzzMapperCatchFixtureOwners(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"function", "arrow", "shadowed-sync", "pipe"} {
		f.Add(key, false, false)
		f.Add(key, true, false)
		f.Add(key, false, true)
		f.Add(key, true, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, marked, crlf bool) {
		TestMapperCatchFixtureOwnersQuoted(t)
		owner := ""
		if marked {
			owner = "effect "
		}
		expression := "work() catch () => 0"
		body := owner + "function probe() { return " + expression + " }"
		switch key {
		case "arrow":
			body = "export const probe = " + owner + "() => " + expression
		case "shadowed-sync":
			body = "function sync(f: () => number!!) { return f() }; export function probe() { return sync(" + owner + "() => " + expression + ") }"
		case "pipe":
			body = owner + "function probe() { return work() |> Effect.map(%, (n) => n) catch () => 0 }"
		}
		source := "declare function work(): number!!;\n" + body + "\n"
		if crlf {
			source = "// café 😀\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		keyword := strings.Index(source, " catch ") + 1
		native := toolsCompile(t, w, "FuzzMapperCatchFixtureOwners", map[string]string{"main.vibe": source})
		defer native.Remove()
		count := 0
		for _, d := range native.Diagnostics {
			if IsEK(d) && d.Code() == 504 {
				count++
				if d.Pos() != keyword || d.End() != keyword+5 {
					t.Fatalf("native catch span: %s", d.String())
				}
			}
		}
		want := 1
		if marked {
			want = 0
			if HasError(native.Diagnostics) {
				t.Fatalf("explicit owner rejected: %v", native.Diagnostics)
			}
		}
		if count != want {
			t.Fatalf("native owner %s marked %v: want %d EK0504, got %d", key, marked, want, count)
		}
		projected := vibelangmapper.Project(source, vibelangmapper.FileContext{FileName: filepath.Join(native.Dir, "main.vibe"), ModuleKey: "catch-owners/main"})
		count = 0
		for _, d := range projected.Diagnostics {
			if d.Code == 504 {
				count++
				if d.Start != keyword || d.Length != 5 {
					t.Fatalf("mapped catch span: %+v", d)
				}
			}
		}
		if count != want {
			t.Fatalf("mapped owner %s marked %v: want %d EK0504, got %v", key, marked, want, projected.Diagnostics)
		}
		if marked && len(projected.Diagnostics) != 0 {
			t.Fatal(fmt.Sprint(projected.Diagnostics))
		}
	})
}
