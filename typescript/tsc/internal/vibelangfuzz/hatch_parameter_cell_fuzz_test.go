package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
