package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzPreludeGlobalValue applies Chapter 5's namespace precedence to new X
// and v instanceof X. A namespace must get TypeScript's own rejection, and
// the diagnostic must explain the resolved module. Host-global advice must
// respect Chapter 5's ban everywhere in a .vibe file.
func FuzzPreludeGlobalValue(f *testing.F) {
	startShortBudget(f)
	preludeGlobalMemberRuling(f)
	for _, seed := range []string{
		"dom/Request/new", "dom/Response/instanceof", "dom/Response/new", "dom/Headers/new",
		"dom/Worker/new", "dom/Event/instanceof", "workers/Response/new", "workers/Response/instanceof",
		"class/Response/new", "class/Response/instanceof",
		"dom/Response/new/tryPromise", "dom/Headers/new/try", "dom/Request/new/try-option",
		"dom/Response/instanceof/try", "dom/Worker/new/sync", "workers/Response/new/tryPromise",
	} {
		f.Add([]byte("prelude-global-value:" + seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckPreludeGlobalValue(t, w, parsePreludeGlobalValue(data))
	})
}

var preludeGlobalValueNames = []string{"Request", "Response", "Headers", "Event", "Worker"}

// Wrapper callbacks resolve names with the same module precedence as the
// surrounding source (Chapter 5, Effect's modules are in scope).
var preludeGlobalValueContexts = []string{"plain", "tryPromise", "try", "try-option", "sync"}

type preludeGlobalValueInput struct {
	lib     unionChoice
	name    string
	form    string
	context string
}

func (in preludeGlobalValueInput) expression(x string) string {
	parameters, value := "()", "new "+x+`("http://x")`
	if in.form == "instanceof" {
		parameters, value = "(o: object)", "o instanceof "+x
	}
	switch in.context {
	case "tryPromise":
		value = "Effect.tryPromise(() => Promise.resolve(" + value + "))"
	case "try":
		value = "Effect.try(() => " + value + ")"
	case "try-option":
		value = "Effect.try({ try: () => " + value + ", catch: (e) => e })"
	case "sync":
		value = "sync(() => " + value + ")"
	}
	return "export const v = " + parameters + " => " + value + "\n"
}

// parsePreludeGlobalValue reads `prelude-global-value:<lib>/<name>/<form>`
// with stable textual keys, and otherwise picks from the bytes.
func parsePreludeGlobalValue(data []byte) preludeGlobalValueInput {
	in := preludeGlobalValueInput{preludeGlobalLibs[0], preludeGlobalValueNames[0], "new", "plain"}
	if rest, ok := strings.CutPrefix(string(data), "prelude-global-value:"); ok {
		parts := append(strings.Split(rest, "/"), "", "", "")
		for _, lib := range preludeGlobalLibs {
			if lib.name == parts[0] {
				in.lib = lib
			}
		}
		for _, name := range preludeGlobalValueNames {
			if name == parts[1] {
				in.name = name
			}
		}
		if parts[2] == "instanceof" {
			in.form = parts[2]
		}
		for _, context := range preludeGlobalValueContexts {
			if context == parts[3] {
				in.context = context
			}
		}
		return in
	}
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	in.lib = preludeGlobalLibs[at(0)%len(preludeGlobalLibs)]
	in.name = preludeGlobalValueNames[at(1)%len(preludeGlobalValueNames)]
	if at(2)%2 == 1 {
		in.form = "instanceof"
	}
	in.context = preludeGlobalValueContexts[at(3)%len(preludeGlobalValueContexts)]
	return in
}

// CheckPreludeGlobalValue compares the error on bare X with what its note advises.
func CheckPreludeGlobalValue(t *testing.T, w *Workspace, in preludeGlobalValueInput) {
	const target = "FuzzPreludeGlobalValue"
	defer recoverCompilerPanic(t, target)
	bare := in.expression(in.name)
	g := &Gaps{Target: target, Input: in.lib.name + "\n" + bare}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	project := func(text string) Project {
		return preludeGlobalInput{lib: in.lib}.project("main.vibe", text)
	}
	var codes []string
	errors := func(text string) []string {
		codes = nil
		r, err := w.Compile(t.Context(), project(text))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var out []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") {
				source := d.Source()
				if source == "" {
					source = "TS"
				}
				codes = append(codes, diagnosticCodeName(source, d.Code()))
				var b strings.Builder
				flatten(&b, d, 0)
				out = append(out, b.String())
			}
		}
		return out
	}
	got := errors(bare)
	bareCodes := slices.Clone(codes)
	spelled := errors(in.expression("globalThis." + in.name))
	checkPreludeGlobalValueDiagnostics(g, in, bareCodes, got, spelled)
	g.FinishInput(t, key)
}

// The rejection and explanation are positive obligations. An empty diagnostic
// list or a reworded/missing note cannot disable the oracle.
func checkPreludeGlobalValueDiagnostics(g *Gaps, in preludeGlobalValueInput, codes []string, got, spelled []string) {
	want := "TS2351"
	if in.form == "instanceof" {
		want = "TS2359"
	}
	if len(codes) != 1 || codes[0] != want {
		g.Add("feature:prelude-global-value:diagnostic", "005-services module precedence: %s/%s requires one %s, got %v: %q", in.name, in.form, want, codes, got)
	}
	note := strings.Join(got, "\n")
	platform := in.lib.name == "dom"
	if !strings.Contains(note, in.name+" is Effect's "+in.name+" module") || !strings.Contains(note, "in scope without an import") {
		g.Add("feature:prelude-global-value:note-module", "005-services module precedence requires the note to explain %s's Effect binding: %s", in.name, note)
	}
	reach := "globalThis." + in.name
	if platform && !strings.Contains(note, "platform code, which lives in a .ts file") {
		g.Add("feature:prelude-global-value:note-platform", "005-services platform ban requires .ts advice for %s: %s", in.name, note)
	}
	if !platform && len(spelled) == 0 && !strings.Contains(note, "write "+reach) {
		g.Add("feature:prelude-global-value:note-global", "005-services: available non-host global %s must be named: %s", reach, note)
	}
	if strings.Contains(note, "write "+reach) && len(spelled) != 0 {
		g.Add("feature:prelude-global-value:note-advises-refused", "the note advises %s, which the compiler refuses: %s; %q", reach, note, spelled)
	}
	if platform && strings.Contains(note, reach) || strings.Contains(note, "inside a hatch") {
		g.Add("feature:prelude-global-value:note-hatch", "005-services bans host access anywhere in a .vibe file: %s", note)
	}
}
