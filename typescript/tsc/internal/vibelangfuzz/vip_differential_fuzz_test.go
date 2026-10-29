package vibelangfuzz

import (
	"fmt"
	"maps"
	"math/rand/v2"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// FuzzVIPDifferential is the differential test VIP-31 asks for: "Each
// VIP's VibeLang and Effect TS pair is a differential test that compiles
// one, runs both, and compares their `Exit`s. The fuzz suite generates more
// pairs." Its oracles:
//
//   - Reference: vipgen prints each program twice, as main.vibe and as the
//     Effect TS its constructs' VIPs show (ref.mjs, untyped JavaScript that
//     never passes through the compiler). TestVIPTemplatesCited checks that
//     each template is the one its VIP shows.
//   - Compilation: a generated program uses only accepted constructs, so it
//     compiles with no error (VIP-31: every accepted construct "is exact sugar
//     for Effect").
//   - Exit (VIP-31: "Compiled output gives the same `Exit` as the Effect
//     TypeScript shown in each VIP"): main.vibe's main() ends with the same
//     Exit as the reference's, compared by VIPCompare: the same kind, the
//     same value, or the same reasons, in order, with their payloads; and
//     the same event log, in order.
//   - Coldness (VIP-1: "Calling an `effect` function returns its Effect
//     unrun"): calling an effect program's main() logs nothing before its
//     Effect runs. A plain program's main is a plain function, which runs its
//     body when called, in both prints alike (VIPCompare's "called").
//
// A program is an effect program or a plain one (vipgen.Program): a plain
// program's main, `export function main() { …; return Effect.succeed(v) }`,
// holds only plain code, so the constructs that work there, such as VIP-23's
// pipe on numbers, are compared before VIP-1's declarations compile.
//
// Two runs of the same reference that differ, a reference that does not end
// with an Exit, or a reference Exit that does not encode is the generator's
// bug, never a gap.

const vipTarget = "FuzzVIPDifferential"

// vipEnv is a workspace with the event log installed and a Node worker.
type vipEnv struct {
	w    *Workspace
	node *Node
}

func newVIPEnv(tb testing.TB) *vipEnv {
	tb.Helper()
	w := NewWorkspace(tb)
	if err := installVIPEvents(w); err != nil {
		tb.Fatal(err)
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(tb, "%v", err)
	}
	tb.Cleanup(node.Close)
	return &vipEnv{w: w, node: node}
}

// A vipRun is one program compiled and run: the reference's outcome, the
// compilation's errors and, when it compiled, main.vibe's outcome.
type vipRun struct {
	files  map[string]string
	ref    VIPOutcome
	errors []*ast.Diagnostic
	got    VIPOutcome
}

// run compiles a program's VibeLang print and runs both prints. The
// reference runs twice, from two module paths; a reference that differs
// across the two runs is a generator bug.
func (e *vipEnv) run(t *testing.T, p *vipgen.Program) *vipRun {
	t.Helper()
	reference := vipgen.PrintEffect(p)
	run := &vipRun{files: map[string]string{"main.vibe": vipgen.PrintVibe(p), "ref.mjs": reference, "ref-again.mjs": reference}}
	var r *Result
	var err error
	Within("compile", func() { r, err = e.w.Compile(t.Context(), Project{Files: run.files}) })
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	run.ref = e.node.RunVIP(r, "ref.mjs")
	if err := vipReferenceStable(run.ref, e.node.RunVIP(r, "ref-again.mjs"), !p.Plain); err != nil {
		t.Fatalf("a generator bug: %v\n%s", err, Archive(run.files))
	}
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			run.errors = append(run.errors, d)
		}
	}
	if len(run.errors) == 0 {
		run.got = e.node.RunVIP(r, "out/main.js")
	}
	return run
}

// vipReferenceStable reports what is wrong with a reference that two runs
// show: it must end with an Exit that encodes, run nothing when main() is
// called if cold is set (an effect program, VIP-1), and end the same way
// both times.
func vipReferenceStable(first, second VIPOutcome, cold bool) error {
	if first.Kind != "exit" {
		return fmt.Errorf("the reference ended %s, not with an Exit: %s", first.Kind, first.Log)
	}
	if cold && len(first.Called) > 0 {
		return fmt.Errorf("calling the reference's main() logged %q", first.Called)
	}
	if _, err := CanonicalVIPExit(first.Exit); err != nil {
		return fmt.Errorf("the reference's Exit does not encode: %w", err)
	}
	if aspect, diff := VIPCompare(first, second); aspect != "" {
		return fmt.Errorf("the reference differs across two runs of the same program (%s): %s", aspect, diff)
	}
	return nil
}

// failures returns what disagrees with the specification: a key and its
// report for each error code of the compilation, or the Exit's disagreement.
func (run *vipRun) failures() map[string]string {
	out := map[string]string{}
	var all []string
	for _, d := range run.errors {
		all = append(all, specDiagnosticText(d))
	}
	for _, d := range run.errors {
		key := "compile:" + diagnosticKey(d)
		if _, seen := out[key]; !seen {
			out[key] = fmt.Sprintf("a program of accepted constructs does not compile: %s\n%s\n%s", specDiagnosticText(d), strings.Join(all, "\n"), Archive(run.files))
		}
	}
	if len(run.errors) == 0 {
		if aspect, diff := VIPCompare(run.ref, run.got); aspect != "" {
			out["exit:"+aspect] = fmt.Sprintf("main.vibe ends differently from its VIPs' Effect TS: %s\n%s\n%s", diff, run.got.Log, Archive(run.files))
		}
	}
	return out
}

// vipGaps collects a program's gaps. A gap is keyed <oracle>/<construct>:
// the first construct of the program, its focus first, whose pending line
// lists that key. A compile gap of a program that holds a construct the
// compiler does not implement yet (its feature line, owned by compiler) is
// that line's: the construct is not lowered, so the program cannot compile.
// An Exit gap is never excused by a feature line, since a program that
// compiles has its construct lowered. Any other gap is keyed by the focus
// and fails.
type vipGaps struct {
	t     *testing.T
	found []specGap
}

func (g *vipGaps) add(key string, p *vipgen.Program, text string) {
	g.t.Helper()
	before := len(g.found)
	g.attribute(key, p, text)
	// Several error codes of one program are often one pending line's.
	added := g.found[before]
	if slices.ContainsFunc(g.found[:before], func(f specGap) bool { return f.key == added.key }) {
		g.found = g.found[:before]
	}
}

func (g *vipGaps) attribute(key string, p *vipgen.Program, text string) {
	order := append([]string{p.Focus}, slices.DeleteFunc(p.UsedKeys(), func(k string) bool { return k == p.Focus })...)
	for _, c := range order {
		if _, ok := Pending(vipTarget, key+"/"+c); ok {
			g.found = append(g.found, specGap{vipTarget, key + "/" + c, text})
			return
		}
	}
	if strings.HasPrefix(key, "compile:") {
		for _, c := range order {
			if e, ok := Pending(vipTarget, "feature:"+c); ok && productOwners[e.Owner] {
				g.found = append(g.found, specGap{vipTarget, "feature:" + c, text})
				return
			}
		}
	}
	g.found = append(g.found, specGap{vipTarget, key + "/" + p.Focus, text})
}

// finish fails on each gap no pending line lists and skips when every gap
// is pending. With no gap, a pending reproduction fails as XPASS.
func (g *vipGaps) finish(corpusKey string) {
	g.t.Helper()
	(&specGaps{t: g.t, target: vipTarget, found: g.found}).finish(corpusKey, true)
}

// vipLeaveOut is the constructs a campaign leaves out: every pending one,
// unless VIBELANG_FUZZ_PENDING=1. The plain constructs no pending line lists
// keep a campaign generating plain programs while the effect constructs are
// pending.
func vipLeaveOut() map[string]bool {
	leaveOut := map[string]bool{}
	for name := range PendingFeatures(vipTarget) {
		leaveOut[name] = true
	}
	return leaveOut
}

// vipSeeds holds each construct's probe input and, without -short, a rich
// input per construct that turns on every construct of the swarm.
func vipSeeds() [][]byte {
	var seeds [][]byte
	r := rand.New(rand.NewPCG(3, 1))
	for _, c := range vipgen.Constructs() {
		seed := vipgen.Seed(c.Key)
		seeds = append(seeds, seed)
		if !testing.Short() {
			rich := append(slices.Clone(seed), 0xff, 0xff)
			for range 256 {
				rich = append(rich, byte(r.IntN(256)))
			}
			seeds = append(seeds, rich)
		}
	}
	return seeds
}

// FuzzVIPDifferential generates a program of the constructs no pending line
// lists, compiles its VibeLang print, and requires no error and the Exit,
// event log and coldness of its VIPs' Effect TS.
func FuzzVIPDifferential(f *testing.F) {
	for _, seed := range vipSeeds() {
		f.Add(seed)
	}
	env := newVIPEnv(f)
	leaveOut := vipLeaveOut()
	f.Fuzz(func(t *testing.T, data []byte) {
		p := vipgen.Generate(data, leaveOut)
		if p == nil {
			t.Skip("every construct is pending; VIBELANG_FUZZ_PENDING=1 generates them, and TestVIPConstructs runs their probes")
		}
		run := env.run(t, p)
		g := &vipGaps{t: t}
		failures := run.failures()
		for _, key := range mapKeys(failures) {
			g.add(key, p, failures[key])
		}
		g.finish(specCorpusKey(t))
	})
}

// TestVIPConstructs checks the registry and runs every construct's probe,
// its minimal program, also under -short and whatever PendingFeatures
// leaves out. A probe that fails is a failure, unless the construct or one
// it requires has a pending line, which the skip names. A pending probe that
// passes fails as XPASS: the compiler implements the construct now, so its
// line is deleted and campaigns generate it.
func TestVIPConstructs(t *testing.T) {
	keyShape := regexp.MustCompile(`^vip(\d{2})\.[a-z][a-z0-9-]*$`)
	for _, c := range vipgen.Constructs() {
		m := keyShape.FindStringSubmatch(c.Key)
		if m == nil {
			t.Errorf("%s: a construct's key is vipNN.<name>", c.Key)
		} else if n, _ := strconv.Atoi(m[1]); n != c.VIP {
			t.Errorf("%s: its key names VIP-%d, but it says VIP-%d", c.Key, n, c.VIP)
		}
		for _, r := range c.Requires {
			if vipgen.Lookup(r) == nil {
				t.Errorf("%s requires %s, which is not registered", c.Key, r)
			}
			if slices.Contains(vipgen.Closure(r), c.Key) {
				t.Errorf("%s and %s require each other", c.Key, r)
			}
		}
		// A plain construct stands in a plain program's plain main, so it
		// requires only plain constructs, and none of VIP-1's or VIP-5's.
		switch {
		case c.Plain:
			for _, k := range vipgen.Closure(c.Key) {
				if r := vipgen.Lookup(k); !r.Plain || r.VIP == 1 || r.VIP == 5 || r.Declare != nil {
					t.Errorf("%s is plain, but requires %s, which a plain program cannot hold", c.Key, k)
				}
			}
		case !slices.ContainsFunc(vipgen.Closure(c.Key), func(k string) bool { return vipgen.Lookup(k).Declare != nil }):
			t.Errorf("%s: nothing it requires declares a function, so no program can hold it", c.Key)
		}
		if c.Focus == nil {
			t.Errorf("%s has no Focus, so its probe does not show it", c.Key)
		}
	}
	env := newVIPEnv(t)
	for _, c := range vipgen.Constructs() {
		t.Run(c.Key, func(t *testing.T) {
			p := vipgen.Probe(c.Key)
			if p.Focus != c.Key || !p.Used[c.Key] || p.Plain != c.Plain {
				t.Fatalf("the probe of %s focuses %s and holds %v", c.Key, p.Focus, p.UsedKeys())
			}
			run := env.run(t, p)
			failures := run.failures()
			if len(failures) == 0 {
				ExpectPending(t, vipTarget, "feature:"+c.Key)
				return
			}
			var report []string
			for _, key := range mapKeys(failures) {
				report = append(report, key+": "+failures[key])
			}
			// The construct's own line first, then the lines of what it
			// requires, whose failure fails its probe too.
			order := append([]string{c.Key}, slices.DeleteFunc(vipgen.Closure(c.Key), func(k string) bool { return k == c.Key })...)
			for _, k := range order {
				if e, ok := Pending(vipTarget, "feature:"+k); ok && productOwners[e.Owner] {
					t.Skipf("pending (%s) feature:%s: %s\n%s", e.Owner, k, e.Reason, strings.Join(report, "\n"))
				}
			}
			// A probe that compiles and whose every disagreement a gap's
			// line lists, keyed <oracle>/<construct> by one of its
			// constructs, is skipped too: the construct is lowered, and
			// the line names what disagrees.
			var gaps []string
			for _, key := range mapKeys(failures) {
				i := slices.IndexFunc(order, func(k string) bool { _, ok := Pending(vipTarget, key+"/"+k); return ok })
				if i < 0 {
					gaps = nil
					break
				}
				e, _ := Pending(vipTarget, key+"/"+order[i])
				gaps = append(gaps, fmt.Sprintf("%s/%s (%s): %s", key, order[i], e.Owner, e.Reason))
			}
			if len(gaps) > 0 {
				t.Skipf("pending %s\n%s", strings.Join(gaps, "; "), strings.Join(report, "\n"))
			}
			t.Errorf("the probe of %s fails, and no pending line lists it or what it requires:\n%s", c.Key, strings.Join(report, "\n"))
		})
	}
}

// vipText returns the text of VIP n in docs/design/vips/.
func vipText(n int) (string, error) {
	names, _ := filepath.Glob(filepath.Join(Root(), "docs/design/vips", fmt.Sprintf("%04d-*.md", n)))
	if len(names) != 1 {
		return "", fmt.Errorf("VIP-%d is not in docs/design/vips/ (%d files)", n, len(names))
	}
	data, err := os.ReadFile(names[0])
	return string(data), err
}

var (
	vipCodeBlock   = regexp.MustCompile("(?ms)^[ \t]*```[^\n]*\n(.*?)^[ \t]*```")
	vipPlaceholder = regexp.MustCompile(`‹[^›]*›`)
	vipToken       = regexp.MustCompile(`[A-Za-z_$][\w$]*|\d+|\S`)
)

// vipTokens splits code into identifiers, numbers and single punctuation
// marks, without a template's ‹placeholders›.
func vipTokens(code string) []string {
	return vipToken.FindAllString(vipPlaceholder.ReplaceAllString(code, " "), -1)
}

// vipInOrder reports whether want's tokens appear in have, in order.
func vipInOrder(want, have []string) bool {
	i := 0
	for _, tok := range have {
		if i < len(want) && tok == want[i] {
			i++
		}
	}
	return i == len(want)
}

// TestVIPTemplatesCited reads docs/design/vips/ at test time. Each
// construct's citations must quote their VIP verbatim, and each template's
// tokens must appear, in order, in a code block of its VIP, or the citation
// gives the suite's reading, which this test lists. A reading the VIP now
// states in code is confirmed, and is listed for deletion, not failed: VIP
// edits land as documents and must not fail the next gate. A template the
// suite cites as code that its VIP no longer shows fails, since the VIP
// changed its Effect TS and the reference may be wrong; so does a quote the
// VIP no longer says when the template is not in its code either. The
// construct's probe's reference print must hold each template too, so the
// printer writes what is cited.
func TestVIPTemplatesCited(t *testing.T) {
	space := regexp.MustCompile(`\s+`)
	normal := func(s string) string { return space.ReplaceAllString(s, " ") }
	var readings, stale []string
	for _, c := range vipgen.Constructs() {
		if len(c.Citations) == 0 {
			t.Errorf("%s cites no VIP", c.Key)
		}
		probe := vipgen.PrintEffect(vipgen.Probe(c.Key))
		for _, cite := range c.Citations {
			text, err := vipText(cite.VIP)
			if err != nil {
				t.Errorf("%s: %v", c.Key, err)
				continue
			}
			want := vipTokens(cite.Template)
			if len(want) == 0 {
				t.Errorf("%s: a citation of VIP-%d has no template", c.Key, cite.VIP)
				continue
			}
			shown := false
			for _, m := range vipCodeBlock.FindAllStringSubmatch(text, -1) {
				shown = shown || vipInOrder(want, vipTokens(m[1]))
			}
			if cite.Quote == "" || !strings.Contains(normal(text), normal(cite.Quote)) {
				if shown {
					stale = append(stale, fmt.Sprintf("%s: VIP-%d no longer says %q; its code still shows %s, so update the quote", c.Key, cite.VIP, cite.Quote, cite.Template))
				} else {
					t.Errorf("%s: VIP-%d does not say %q", c.Key, cite.VIP, cite.Quote)
				}
			}
			switch {
			case shown && cite.Reading != "":
				stale = append(stale, fmt.Sprintf("%s: VIP-%d now shows %s in code, confirming the reading; delete the reading %q", c.Key, cite.VIP, cite.Template, cite.Reading))
			case !shown && cite.Reading == "":
				t.Errorf("%s: VIP-%d shows no %q in a code block; give the suite's reading of %q", c.Key, cite.VIP, cite.Template, cite.Quote)
			case !shown:
				readings = append(readings, fmt.Sprintf("%s reads VIP-%d as %s: %s", c.Key, cite.VIP, cite.Template, cite.Reading))
			}
			if !vipInOrder(want, vipTokens(probe)) {
				t.Errorf("%s: the reference print of its probe does not hold %q:\n%s", c.Key, cite.Template, probe)
			}
		}
	}
	t.Logf("%d readings the VIPs do not show in code yet:\n%s", len(readings), strings.Join(readings, "\n"))
	if len(stale) > 0 {
		t.Logf("%d citations to update after a VIP edit:\n%s", len(stale), strings.Join(stale, "\n"))
	}
}

var (
	vipAcceptedRow = regexp.MustCompile(`(?m)^\| \[(\d+)\]\([^)]*\) \|.*\| accepted`)
	vipKeyNumber   = regexp.MustCompile(`^vip(\d{2})\.`)
)

// TestVIPCoverage reads the accepted VIPs from docs/design/vips/README.md at
// test time and logs each one that has no construct, no not-runtime line and
// no "not generated" line, so an accepted VIP is never silently untested. It
// also checks that each of the target's pending lines names a registered
// construct, or a VIP the README accepts.
func TestVIPCoverage(t *testing.T) {
	readme, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	accepted := map[int]bool{}
	for _, m := range vipAcceptedRow.FindAllStringSubmatch(string(readme), -1) {
		n, _ := strconv.Atoi(m[1])
		accepted[n] = true
	}
	if len(accepted) == 0 {
		t.Fatal("docs/design/vips/README.md lists no accepted VIP")
	}
	covered := map[int]string{}
	for _, c := range vipgen.Constructs() {
		if !accepted[c.VIP] {
			t.Errorf("%s: VIP-%d is not accepted in docs/design/vips/README.md", c.Key, c.VIP)
		}
		covered[c.VIP] = "construct " + c.Key
	}
	entries, err := pendingEntries()
	if err != nil {
		t.Fatal(err)
	}
	var debt []string
	for _, e := range entries {
		if e.Target != vipTarget {
			continue
		}
		id := e.Target + " " + e.Key
		switch prefix, name, _ := strings.Cut(e.Key, ":"); prefix {
		case "not-runtime":
			n, err := strconv.Atoi(strings.TrimPrefix(name, "vip"))
			switch {
			case err != nil || !strings.HasPrefix(name, "vip"):
				t.Errorf("%s: a not-runtime key is not-runtime:vipNN", id)
			case !accepted[n]:
				t.Errorf("%s: VIP-%d is not accepted", id, n)
			case covered[n] != "":
				t.Errorf("%s: VIP-%d has a %s", id, n, covered[n])
			default:
				covered[n] = "not-runtime line"
			}
		case "feature":
			if c := vipgen.Lookup(name); c != nil {
				if !productOwners[e.Owner] || !strings.Contains(e.Reason, fmt.Sprintf("VIP-%d:", c.VIP)) || !strings.Contains(e.Reason, "lane ") {
					t.Errorf("%s: a pending construct's line is owned by compiler and names its VIP (VIP-%d:) and the lane that implements it", id, c.VIP)
				}
				continue
			}
			m := vipKeyNumber.FindStringSubmatch(name)
			if m == nil || productOwners[e.Owner] || !strings.HasPrefix(e.Reason, "not generated") {
				t.Errorf("%s: no construct %s is registered; a line for a construct not written yet is owned by this area and starts \"not generated\"", id, name)
				continue
			}
			// A VIP may have constructs written and others not yet, as
			// VIP-1's shorthand and arrow forms beside its function.
			if n, _ := strconv.Atoi(m[1]); !accepted[n] {
				t.Errorf("%s: VIP-%d is not accepted", id, n)
			} else if covered[n] == "" {
				covered[n] = "not generated"
			}
			debt = append(debt, name)
		case "compile", "exit":
			if i := strings.LastIndex(name, "/"); i < 0 || vipgen.Lookup(name[i+1:]) == nil {
				t.Errorf("%s: a gap key ends /<construct>, a registered construct", id)
			}
		case "corpus":
		default:
			t.Errorf("%s: an unknown key", id)
		}
	}
	// VIP-31 is the guarantee this target checks.
	if accepted[31] && covered[31] == "" {
		covered[31] = "this target"
	}
	// A VIP accepted after this file was written is the target's debt until a
	// line or a construct covers it. It is logged, not failed: a VIP lands as
	// a document, and must not fail the next compiler change's gate.
	var uncovered []int
	for _, n := range slices.Sorted(maps.Keys(accepted)) {
		if covered[n] == "" {
			uncovered = append(uncovered, n)
		}
	}
	t.Logf("%d accepted VIPs; constructs not generated yet: %v; VIPs with no line yet: %v", len(accepted), debt, uncovered)
}
