package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// PREVIEW-3 (rev-preview pass 9): EK4616's fix rewrites a retired try hatch,
// try((p) => body, p), as Effect.try's thunk. VIP-34: "code that compiled
// under the previous release migrates mechanically", and Chapter 28: "Each
// fix keeps the program's meaning". The hatch called its arrow with its
// inputs, so the parameter p is a binding of its own even when its input is
// a variable spelled p: a write to it, or a closure that reads it later, never
// reaches the caller's p. The generator writes a hatch whose same-name
// parameter the body reads, assigns, destructures, loops over, captures or
// shadows, with an optional second input of the same name or a literal and an
// optional written type, and a getter input before or after it that
// changes the caller's p, runs vibelang --fix --fix-vip-only, and runs the
// fixed program. The oracle is the reference that keeps the call,
// Effect.try(() => (arrow)(inputs)): the same exit and value.
var hatchCellUses = []struct {
	key, body, observe string
}{
	{"read", `p + "1"`, "out"},
	{"assign", `{ p = p + "!"; return p }`, "out"},
	{"compound", `{ p += "?"; return p }`, "out"},
	{"destructure", `{ [p] = ["d"]; return p }`, "out"},
	{"for-of", `{ for (p of ["f"]) { } return p }`, "out"},
	{"capture", `() => p`, "(out as () => unknown)()"},
	{"capture-assign", `() => { p = "c"; return p }`, "(out as () => unknown)()"},
	{"stored", `({ get: () => p })`, "(out as { get: () => unknown }).get()"},
	{"shadow", `[p].map((p) => p + "s")[0]`, "out"},
}

// A getter input (pass 41) changes the caller's p when it is read: the call
// read every input first, left to right, so the parameter p holds the value
// p had at its own position, before or after the getter ran.
var hatchCellSeconds = []struct {
	key, param, input string
	first             bool
}{
	{"none", "", "", false},
	{"same-name", "q", "q", false},
	{"literal", "q", `"L"`, false},
	{"getter-after", "q", "box.value", false},
	{"getter-before", "q", "box.value", true},
}

// hatchCellShape reads a keyed input ("assign/same-name/typed") or picks the
// use, the second input and the type by byte.
func hatchCellShape(data []byte) (use, second int, typed bool) {
	if parts := strings.Split(string(data), "/"); len(parts) == 3 {
		u := slices.IndexFunc(hatchCellUses, func(u struct{ key, body, observe string }) bool { return u.key == parts[0] })
		s := slices.IndexFunc(hatchCellSeconds, func(s struct {
			key, param, input string
			first             bool
		}) bool {
			return s.key == parts[1]
		})
		if u >= 0 && s >= 0 {
			return u, s, parts[2] == "typed"
		}
	}
	for len(data) < 3 {
		data = append(data, 0)
	}
	return int(data[0]) % len(hatchCellUses), int(data[1]) % len(hatchCellSeconds), data[2]%2 == 1
}

func FuzzHatchParameterCell(f *testing.F) {
	startShortBudget(f)
	for _, u := range hatchCellUses {
		f.Add([]byte(u.key + "/none/untyped"))
	}
	for _, seed := range []string{"read/getter-after/untyped", "capture/getter-before/untyped", "assign/getter-before/typed", "read/getter-before/untyped", "assign/same-name/untyped", "capture/literal/typed", "read/same-name/typed", "capture-assign/same-name/typed", "shadow/literal/untyped"} {
		f.Add([]byte(seed))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "%v", err)
	}
	f.Cleanup(node.Close)
	f.Fuzz(func(t *testing.T, data []byte) {
		use, second, typed := hatchCellShape(data)
		u, s := hatchCellUses[use], hatchCellSeconds[second]
		shape := u.key + "/" + s.key + "/" + map[bool]string{true: "typed", false: "untyped"}[typed]
		params, inputs := "p", "p"
		if typed {
			params = "p: string"
		}
		if s.param != "" && s.first {
			params, inputs = s.param+", "+params, s.input+", "+inputs
		} else if s.param != "" {
			params += ", " + s.param
			inputs += ", " + s.input
		}
		arrow := "(" + params + ") => " + u.body
		program := func(hatch string) string {
			// between is the caller's p right after the hatch: a write to the
			// parameter must not reach it; seen is read after p changes, so a
			// closure must not see the caller's later p either
			return "export effect function main() {\n  let p = \"a\"\n  let q = \"b\"\n  const box = { get value() { p = \"g\"; return p } }\n  const out = " + hatch + "\n  const between = [p, q]\n  p = \"z\"\n  q = \"y\"\n  const seen = " + u.observe + "\n  return [seen, between, p, q]\n}\n"
		}
		original := map[string]string{"main.vibe": program("try(" + arrow + ", " + inputs + ")")}
		reference := map[string]string{"main.vibe": program("try Effect.try(() => (" + arrow + ")(" + inputs + "))")}
		ref := toolsCompile(t, w, "FuzzHatchParameterCell", reference)
		defer ref.Remove()
		if errs := hatchCellErrors(ref); len(errs) > 0 {
			Gap(t, "FuzzHatchParameterCell", "reference:"+shape, "the reference does not compile:\n%s\n%s", reference["main.vibe"], strings.Join(errs, "\n"))
			return
		}
		r := toolsCompile(t, w, "FuzzHatchParameterCell", original)
		defer r.Remove()
		config := toolsConfig(w, r.Dir)
		if r.Program == nil || config == nil || len(config.Errors) > 0 {
			t.Fatalf("no program for %s", shape)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		fixed := maps.Clone(original)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(r.Dir)+"/")] = file.Text
		}
		if len(result.Refused) > 0 || fixed["main.vibe"] == original["main.vibe"] {
			Gap(t, "FuzzHatchParameterCell", "refused:"+shape, "--fix-vip-only did not rewrite the hatch (refused %+v):\n%s", result.Refused, original["main.vibe"])
			return
		}
		after := toolsCompile(t, w, "FuzzHatchParameterCell", fixed)
		defer after.Remove()
		if errs := hatchCellErrors(after); len(errs) > 0 {
			Gap(t, "FuzzHatchParameterCell", "compile:"+shape, "the fixed program does not compile:\n%s\n%s", fixed["main.vibe"], strings.Join(errs, "\n"))
			return
		}
		want := node.Run(ref, "out/main.js", "main")
		got := node.Run(after, "out/main.js", "main")
		if toolsInvalidOutcome(want) {
			Gap(t, "FuzzHatchParameterCell", "reference-run:"+shape, "the reference did not run: %s %s\n%s", want.Kind, want.Log, reference["main.vibe"])
			return
		}
		if !toolsSameOutcome(want, got) {
			Gap(t, "FuzzHatchParameterCell", "outcome:"+shape, "Chapter 28: \"Each fix keeps the program's meaning\"; the reference %s %s, the fixed program %s %s:\n%s\nfixed:\n%s", want.Kind, want.Value, got.Kind, got.Value, original["main.vibe"], fixed["main.vibe"])
			return
		}
		ExpectPending(t, "FuzzHatchParameterCell", "outcome:"+shape)
	})
}

func hatchCellErrors(r *Result) []string {
	var errs []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errs = append(errs, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
	}
	if r.EmitSkipped {
		errs = append(errs, "emit skipped")
	}
	return errs
}
