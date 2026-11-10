package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzPlatformHatchSymbols checks the migration severity of EK4402 across the
// kinds of host access, not just one. Chapter 5 makes EK4402 a warning in a
// formerly accepted sync, callback, Effect.try or Effect.tryPromise callback
// and keeps unwrapped host access an error; Appendix B reports host clock and
// randomness reads as EK4402 by resolved host origin, so a clock or
// randomness read in such a callback is a warning like any other host global.
// The key is <symbol>/<wrapper>/<host>: the host access, the callback that
// holds it (or none), and whether the code runs in an effect function, a
// plain function returning the Effect, or a top-level const.

const platformHatchTarget = "FuzzPlatformHatchSymbols"

var platformHatchQuotes = []struct{ chapter, text string }{
	{"005-services.md", "During migration, `EK4402` in a formerly accepted `sync`, `callback`, `Effect.try` or `Effect.tryPromise` callback is a warning."},
	{"005-services.md", "The restriction and preserving repair still apply; unwrapped host access and Node value imports remain errors."},
	{"900-appendices.md", "VIP-33 reports host clock and randomness reads as `EK4402` by resolved host origin."},
}

var platformHatchSymbols = []struct{ name, expr string }{
	{"crypto.randomUUID", "crypto.randomUUID()"},
	{"crypto.getRandomValues", "crypto.getRandomValues(new Uint8Array(4))"},
	{"crypto-literal-member", "crypto[\"randomUUID\"]()"},
	{"globalThis.crypto", "globalThis.crypto.randomUUID()"},
	{"performance.now", "performance.now()"},
	{"console.log", "console.log(\"x\")"},
	{"setTimeout", "setTimeout(() => {}, 1)"},
	{"localStorage", "localStorage.getItem(\"k\")"},
	{"navigator", "navigator.userAgent"},
	{"fetch", "fetch(\"/\")"},
}

// A wrapper holds the access in a formerly accepted callback; "unwrapped"
// is the control that stays an error.
var platformHatchWrappers = []struct{ name, template string }{
	{"sync", "sync(() => {X})"},
	{"sync-block", "sync(() => { return {X} })"},
	{"sync-function", "sync(function () { return {X} })"},
	{"callback", "callback<void>((resume) => { {X}; resume(Effect.void) })"},
	{"Effect.try", "Effect.try(() => {X})"},
	{"Effect.try-options", "Effect.try({ try: () => {X}, catch: (e) => e })"},
	{"Effect.tryPromise", "Effect.tryPromise(() => Promise.resolve({X}))"},
	{"Effect.tryPromise-options", "Effect.tryPromise({ try: () => Promise.resolve({X}), catch: (e) => e })"},
	{"unwrapped", ""},
}

var platformHatchHosts = []string{"effect", "plain", "top"}

type platformHatchCase struct {
	key, symbol, expr, wrapper, template, host string
}

func platformHatchCases() []platformHatchCase {
	var cases []platformHatchCase
	for _, s := range platformHatchSymbols {
		for _, w := range platformHatchWrappers {
			for _, h := range platformHatchHosts {
				cases = append(cases, platformHatchCase{key: s.name + "/" + w.name + "/" + h, symbol: s.name, expr: s.expr, wrapper: w.name, template: w.template, host: h})
			}
		}
	}
	return cases
}

func (c platformHatchCase) source() string {
	header := "import * as Effect from \"effect/Effect\"\n"
	if c.template == "" {
		switch c.host {
		case "effect":
			return header + "export effect function probe() {\n  const v = " + c.expr + "\n  return v\n}\n"
		case "plain":
			return header + "export function probe() {\n  const v = " + c.expr + "\n  return v\n}\n"
		}
		return header + "export const probe = " + c.expr + "\n"
	}
	call := strings.ReplaceAll(c.template, "{X}", c.expr)
	switch c.host {
	case "effect":
		return header + "export effect function probe() {\n  const v = try " + call + "\n  return v\n}\n"
	case "plain":
		return header + "export function probe() {\n  return " + call + "\n}\n"
	}
	return header + "export const probe = " + call + "\n"
}

// gapKey is the pending key of a cell: <symbol>/hatch for every formerly
// accepted callback and host, which share one verdict per host access, and
// the cell's own key for unwrapped access.
func (c platformHatchCase) gapKey() string {
	if c.template == "" {
		return c.key
	}
	return c.symbol + "/hatch"
}

func checkPlatformHatch(t *testing.T, w *Workspace, c platformHatchCase) {
	t.Helper()
	files := map[string]string{"main.vibe": c.source()}
	r, err := w.Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var host, other []string
	errors := 0
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == 4402 {
			host = append(host, describe(d))
			if d.Category() == diagnostics.CategoryError {
				errors++
			}
			continue
		}
		if d.Category() == diagnostics.CategoryError {
			other = append(other, describe(d))
		}
	}
	// Unwrapped access in effect code may break other rules too (an
	// unwrapped Promise is EK0404); only a wrapped cell must be otherwise
	// well typed.
	if len(other) > 0 && c.template != "" {
		t.Fatalf("%s is not otherwise well typed: %s\n%s", c.key, strings.Join(other, "; "), Archive(files))
	}
	switch {
	case len(host) == 0:
		Gap(t, platformHatchTarget, c.gapKey(), "Chapter 5: %s reaches the platform, so it is EK4402, but the compiler reports none\n%s", c.symbol, Archive(files))
	case c.template == "" && errors == 0:
		Gap(t, platformHatchTarget, c.gapKey(), "Chapter 5: unwrapped host access remains an error, but %s reports: %s\n%s", c.symbol, strings.Join(host, "; "), Archive(files))
	case c.template != "" && errors > 0:
		Gap(t, platformHatchTarget, c.gapKey(), "Chapter 5: EK4402 in a formerly accepted %s callback is a warning, but %s reports: %s\n%s", c.wrapper, c.symbol, strings.Join(host, "; "), Archive(files))
	}
	ExpectPending(t, platformHatchTarget, c.gapKey())
}

func TestPlatformHatchSymbolsQuoted(t *testing.T) {
	for _, q := range platformHatchQuotes {
		r4Quoted(t, q.chapter, q.text)
	}
	if !strings.HasPrefix(Facts().Rows[4402].Reports, platformContextualRow) {
		t.Fatalf("Appendix B's EK4402 row no longer starts %q", platformContextualRow)
	}
}

// TestPlatformHatchSymbolsWitness compiles the alchemy minimum: a UUID read
// in the sync callback of an effect function, which alchemy's
// GlobalVmExtensionPolicy writes and kept as TypeScript.
func TestPlatformHatchSymbolsWitness(t *testing.T) {
	TestPlatformHatchSymbolsQuoted(t)
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-sync-hatch-random-uuid.json"))
	if err != nil {
		t.Fatal(err)
	}
	var witness struct{ Source, Main string }
	if err := json.Unmarshal(raw, &witness); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{"main.vibe": witness.Main}
	r, err := NewWorkspace(t).Compile(t.Context(), Project{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	warnings := 0
	var problems []string
	for _, d := range r.Diagnostics {
		if IsEK(d) && d.Code() == 4402 && d.Category() == diagnostics.CategoryWarning {
			warnings++
		} else if d.Category() == diagnostics.CategoryError {
			problems = append(problems, describe(d))
		}
	}
	if len(problems) > 0 || warnings == 0 {
		Gap(t, platformHatchTarget, "witness:alchemy-sync-hatch-random-uuid", "Chapter 5: %s: want an EK4402 warning and no error, got %d warnings and: %s\n%s", witness.Source, warnings, strings.Join(problems, "; "), Archive(files))
	}
	ExpectPending(t, platformHatchTarget, "witness:alchemy-sync-hatch-random-uuid")
}

func FuzzPlatformHatchSymbols(f *testing.F) {
	startShortBudget(f)
	cases := platformHatchCases()
	f.Add("crypto.randomUUID/sync/effect")
	f.Add("console.log/Effect.try-options/plain")
	f.Add("performance.now/unwrapped/top")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestPlatformHatchSymbolsQuoted(t)
		i := slices.IndexFunc(cases, func(c platformHatchCase) bool { return c.key == key })
		if i < 0 {
			i = len(key) % len(cases)
		}
		checkPlatformHatch(t, w, cases[i])
		ExpectPending(t, platformHatchTarget, specCorpusKey(t))
	})
}

func TestPlatformHatchSymbolsNeighborhood(t *testing.T) {
	if testing.Short() && os.Getenv("VIBELANG_PLATFORM_HATCH_MATRIX") == "" {
		t.Skip("the complete symbol, wrapper and host matrix runs separately")
	}
	TestPlatformHatchSymbolsQuoted(t)
	w := NewWorkspace(t)
	for _, c := range platformHatchCases() {
		t.Run(c.key, func(t *testing.T) { checkPlatformHatch(t, w, c) })
	}
}
