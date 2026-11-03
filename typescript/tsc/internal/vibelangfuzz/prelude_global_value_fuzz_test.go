package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzPreludeGlobalValue is FuzzPreludeGlobalMember's rule for the name itself:
// new X(…) and v instanceof X on a bare X that is Effect's module. The error's
// note must not send the reader to a form the compiler then refuses: it names
// globalThis.X only when globalThis.X compiles in a .vibe file (the same
// compiler, two inputs, RULES.md 1), and a host global's note names a .ts file
// (VIP-33's derived ban). Smithers' Otlp and docs-redirect wrote new Request and
// instanceof Response, and the old note advised globalThis.Request in a hatch,
// which is EK4402 ("anywhere in a `.vibe` file").
func FuzzPreludeGlobalValue(f *testing.F) {
	startShortBudget(f)
	preludeGlobalMemberRuling(f)
	for _, seed := range []string{
		"dom/Request/new", "dom/Response/instanceof", "dom/Response/new", "dom/Headers/new",
		"dom/Worker/new", "dom/Event/instanceof", "workers/Response/new", "workers/Response/instanceof",
		"class/Response/new", "class/Response/instanceof",
	} {
		f.Add([]byte("prelude-global-value:" + seed))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		CheckPreludeGlobalValue(t, w, parsePreludeGlobalValue(data))
	})
}

var preludeGlobalValueNames = []string{"Request", "Response", "Headers", "Event", "Worker"}

type preludeGlobalValueInput struct {
	lib  unionChoice
	name string
	form string
}

func (in preludeGlobalValueInput) expression(x string) string {
	if in.form == "instanceof" {
		return "export const v = (o: object) => o instanceof " + x + "\n"
	}
	return "export const v = () => new " + x + `("http://x")` + "\n"
}

// parsePreludeGlobalValue reads `prelude-global-value:<lib>/<name>/<form>`
// (RULES.md 11), and otherwise picks from the bytes.
func parsePreludeGlobalValue(data []byte) preludeGlobalValueInput {
	in := preludeGlobalValueInput{preludeGlobalLibs[0], preludeGlobalValueNames[0], "new"}
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
	errors := func(text string) []string {
		r, err := w.Compile(t.Context(), project(text))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var out []string
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError && d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/main.vibe") {
				var b strings.Builder
				flatten(&b, d, 0)
				out = append(out, b.String())
			}
		}
		return out
	}
	x := in.name
	reach := "globalThis." + x
	got := errors(bare)
	note := strings.Join(got, "\n")
	spelled := errors(in.expression(reach))
	banned := strings.Contains(strings.Join(spelled, "\n"), "EK4402")
	if strings.Contains(note, "write "+reach) && len(spelled) != 0 {
		g.Add("feature:prelude-global-value:note-advises-refused", "the error names %s, which the compiler refuses:\n%s\n%q", reach, note, spelled)
	}
	if banned && len(got) != 0 && strings.Contains(note, "in scope without an import") && !strings.Contains(note, "platform code, which lives in a .ts file") {
		g.Add("feature:prelude-global-value:note-platform", "VIP-33: %s is EK4402, so the note must send the reader to a .ts file:\n%s", reach, note)
	}
	if strings.Contains(note, "inside a hatch") {
		g.Add("feature:prelude-global-value:note-hatch", "005-services: EK4402 holds \"anywhere in a `.vibe` file\", so a hatch is no way to the global:\n%s", note)
	}
	g.FinishInput(t, key)
}
