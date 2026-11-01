package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// Chapter 1: a declaration file prints what idiomatic Effect TypeScript would
// declare. In a DOM program an Effect module's name is also a global type, and
// an import shadows the global, so such a .ts file imports the module under its
// own name. The .vibe twin, which names the module through the prelude, must
// agree unless the file also writes the ambient type, where only another local
// name can hold both (Smithers' flows/kernel Rooted: FileSystem_1).
const preludeAmbientQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

var preludeAmbientModules = []struct{ name, module string }{
	{"FileSystem", "effect"},
	{"Cache", "effect"},
	{"Headers", "effect/http"},
	{"Event", "effect/eventlog"},
	{"Worker", "effect/workers"},
}

var preludeAmbientShapes = []struct{ key, format string }{
	{"parameter", "export declare function f(value: %s): void\n"},
	{"return", "export declare function f(): %s\n"},
	{"alias", "export type F = %s\n"},
	{"array", "export const f = (values: readonly %s[]): number => values.length\n"},
}

// preludeAmbientUses are the ways a file writes the module's type: the module
// alone, or beside the ambient type, which keeps the alias.
var preludeAmbientUses = []struct {
	key     string
	ambient bool
}{{"qualified", false}, {"beside-ambient", true}}

func preludeAmbientChapter(tb testing.TB) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(chapter), preludeAmbientQuote) {
		tb.Fatalf("chapter 1 no longer says %q", preludeAmbientQuote)
	}
}

func TestPreludeAmbientDeclarationsQuoted(t *testing.T) { preludeAmbientChapter(t) }

func FuzzPreludeAmbientDeclarations(f *testing.F) {
	startShortBudget(f)
	preludeAmbientChapter(f)
	for i, m := range preludeAmbientModules {
		shape := preludeAmbientShapes[i%len(preludeAmbientShapes)]
		f.Add([]byte(m.name + "/" + shape.key + "/qualified"))
		f.Add([]byte(m.name + "/" + shape.key + "/beside-ambient"))
	}
	w := NewWorkspace(f)
	config := strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": [\"main.vibe\"]\n}"
	config = strings.Replace(config, `"strict": true,`, `"strict": true, "lib": ["esnext", "dom"],`, 1)
	f.Fuzz(func(t *testing.T, data []byte) {
		mi, si, ui := 0, 0, 0
		if len(data) > 0 {
			mi = int(data[0]) % len(preludeAmbientModules)
		}
		if len(data) > 1 {
			si = int(data[1]) % len(preludeAmbientShapes)
		}
		if len(data) > 2 {
			ui = int(data[2]) % len(preludeAmbientUses)
		}
		for a, m := range preludeAmbientModules {
			for b, s := range preludeAmbientShapes {
				for c, u := range preludeAmbientUses {
					if string(data) == m.name+"/"+s.key+"/"+u.key {
						mi, si, ui = a, b, c
					}
				}
			}
		}
		m, shape, use := preludeAmbientModules[mi], preludeAmbientShapes[si], preludeAmbientUses[ui]
		qualified := m.name + "." + m.name
		source := fmt.Sprintf(shape.format, qualified)
		if use.ambient {
			source += "export type Host = " + m.name + "\n"
		}
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := m.name + "/" + use.key
		declaration := r.Outputs["out/main.d.ts"]
		plain := "import { " + m.name + " } from \"" + m.module + "\";"
		alias := "import { " + m.name + " as " + m.name + "_1 } from \"" + m.module + "\";"
		want := plain
		if use.ambient {
			want = alias
		}
		if !strings.Contains(declaration, want) {
			Gap(t, "FuzzPreludeAmbientDeclarations", key, "chapter 1: %s; want %s in:\n%s\nfrom:\n%s\n%v", preludeAmbientQuote, want, declaration, source, r.Diagnostics)
			return
		}
		ExpectPending(t, "FuzzPreludeAmbientDeclarations", key)
		ExpectPending(t, "FuzzPreludeAmbientDeclarations", specCorpusKey(t))
	})
}
