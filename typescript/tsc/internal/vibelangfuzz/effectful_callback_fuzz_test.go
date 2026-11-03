package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const effectfulCallbackQuote = "An effectful callable's thrown type is \x60never\x60, and it never rethrows a callback: its failures are its Effect's error channel."
const effectfulCallbackGenericQuote = "A generic signature is classified as effectful before type-argument substitution, through its constraints."

type effectfulCallbackShape struct {
	key, parameters, result string
	effectful               bool
}

var effectfulCallbackShapes = []effectfulCallbackShape{
	{"effect", "", "Effect.Effect<number>", true},
	{"stream", "", "Stream.Stream<number>", true},
	{"layer", "", "Layer.Layer<never>", true},
	{"generic-effect", "<T extends Effect.Effect<number>>", "T", true},
	{"generic-stream", "<T extends Stream.Stream<number>>", "T", true},
	{"generic-layer", "<T extends Layer.Layer<never>>", "T", true},
	{"promise", "", "Promise<number>", false},
	{"any", "", "any", false},
	{"unknown", "", "unknown", false},
	{"never", "", "never", false},
}
var effectfulCallbackSources = []string{"never", "Error", "unknown"}
var effectfulCallbackBounds = []string{"never", "unknown"}

func effectfulCallbackNames() []string {
	var names []string
	for _, shape := range effectfulCallbackShapes {
		for _, source := range effectfulCallbackSources {
			for _, bound := range effectfulCallbackBounds {
				for _, site := range []string{"argument", "initializer"} {
					names = append(names, fmt.Sprintf("%s/%s/to-%s/%s", shape.key, source, bound, site))
				}
			}
		}
	}
	return names
}
func TestEffectfulForeignCallbacksQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", effectfulCallbackQuote, effectfulCallbackGenericQuote, assignabilityQuote)
}
func TestEffectfulForeignCallbackKeys(t *testing.T) {
	names := effectfulCallbackNames()
	if len(names) != 120 {
		t.Fatalf("got%d keys,want120", len(names))
	}
	seen := map[string]bool{}
	for _, name := range names {
		if seen[name] {
			t.Fatalf("duplicate%s", name)
		}
		seen[name] = true
		p := filepath.Join("testdata/fuzz/FuzzEffectfulForeignCallbacks", strings.ReplaceAll(name, "/", "-"))
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), fmt.Sprintf("[]byte(%q)", "key:"+name)) {
			t.Fatalf("wrong key in%s", p)
		}
	}
}
func FuzzEffectfulForeignCallbacks(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", effectfulCallbackQuote, effectfulCallbackGenericQuote, assignabilityQuote)
	names := effectfulCallbackNames()
	r4Seeds(f, names)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i := r4Pick(data, names)
		shape := effectfulCallbackShapes[i/12]
		source := (i / 4) % 3
		bound := (i / 2) % 2
		handlers := fmt.Sprintf("import type { Effect, Stream, Layer } from \"effect\"\n/** @throws {%s} */\n"+
			"export declare function source%s(): %s\n"+
			"export interface Handler {\n /** @throws {%s} */\n %s(): %s\n}\n"+
			"/** @throws {never} */\nexport declare function take(value: Handler): void\n",
			effectfulCallbackSources[source], shape.parameters, shape.result, effectfulCallbackBounds[bound], shape.parameters, shape.result)
		body := "take(source)"
		if i%2 == 1 {
			body = "const saved: Handler = source; return saved"
		}
		main := "import { source, take, type Handler } from \"./handlers.js\"\nexport function check() { " + body + " }\n"
		files := map[string]string{"main.vibe": main, "handlers.d.ts": handlers}
		config := strings.TrimSuffix(DefaultConfig, "\n  }\n}") + ",\n    \"noEmit\": true\n  },\n  \"files\": [\"main.vibe\", \"handlers.d.ts\"]\n}"
		r, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		errs := r4Errors(r.Diagnostics)
		want := !shape.effectful && source != 0 && bound == 0
		got := false
		for _, code := range errs {
			if code != "EK0402" {
				t.Fatalf("%s: unexpected%v\n%s", names[i], errs, Archive(files))
			}
			got = true
		}
		if got != want || len(errs) > 1 {
			Gap(t, "FuzzEffectfulForeignCallbacks", "contract:"+names[i], "003-failures: %s; %s: got%v,wantEK0402=%t\n%s", effectfulCallbackQuote, names[i], errs, want, Archive(files))
		}
	})
}
