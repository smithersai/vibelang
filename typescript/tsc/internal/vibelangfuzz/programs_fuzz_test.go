package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/specgen"
)

// The spec-program targets generate programs that are valid by Part I of the
// specification and check what the specification says they do. Their
// oracles:
//
//   - Compilation (Ch 27): a generated program is valid, so it compiles with
//     no error.
//   - Reference (Ch 1, Appendix C, D266): the Effect TypeScript print of the
//     same model, which reading VibeLang as "is never wrong", compiled in the
//     same project, ends with the same Outcome (Ch 17: success value,
//     failure's error, defect, interruption) and the same trace, the order of
//     observable effects (Ch 13 rule E11).
//   - Contracts (Ch 2-4, Ch 14, Ch 27 rule 4): each exported function's
//     declared Effect.Effect<A, E, R> holds exactly the A, E and R that the
//     model infers: what it throws plus its callees' E minus what it
//     catches, and the services and controls it uses minus those provided
//     or handled.
//   - Variants (FuzzSpecVariants): every metamorphic variant ends as the base
//     print does.

const (
	specTargetPrograms = "FuzzSpecPrograms"
	specTargetVariants = "FuzzSpecVariants"
)

// specProgramSeeds holds, for each feature, a minimal input that focuses on
// it, and, for every fourth feature, a rich input that enables every feature.
// The variants target compiles about ten files per input, so it takes every
// second minimal input and every eighth rich one. -short halves the rich
// inputs and the variants' minimal ones, and keeps every feature's minimal
// input of FuzzSpecPrograms, so the smoke gate compiles each generator
// feature at least once.
func specProgramSeeds() [][]byte {
	if testing.Short() {
		return specSeeds(1, 8)
	}
	return specSeeds(1, 4)
}

func specVariantSeeds() [][]byte {
	if testing.Short() {
		return specSeeds(4, 16)
	}
	return specSeeds(2, 8)
}

func specSeeds(minimalEvery, richEvery int) [][]byte {
	var seeds [][]byte
	r := rand.New(rand.NewPCG(1, 2))
	for i := range specgen.Features {
		rich := append([]byte{byte(i)}, bytes.Repeat([]byte{0xff}, specgen.MaskBytes)...)
		for j := 0; j < 1500; j++ {
			rich = append(rich, byte(r.IntN(256)))
		}
		if i%minimalEvery == 0 {
			seeds = append(seeds, []byte{byte(i)})
		}
		if i%richEvery == 0 {
			seeds = append(seeds, rich)
		}
	}
	return seeds
}

// specProgramRun is one program's compiled project in a workspace.
type specProgramRun struct {
	t    *testing.T
	w    *Workspace
	node *Node
	r    *Result
	p    *specgen.Program
}

// errors returns the error diagnostics of the compilation, as text.
func (s *specProgramRun) errors() []string {
	var out []string
	for _, d := range s.errorDiagnostics() {
		out = append(out, specDiagnosticText(d))
	}
	return out
}

func (s *specProgramRun) errorDiagnostics() []*ast.Diagnostic {
	var out []*ast.Diagnostic
	for _, d := range s.r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			out = append(out, d)
		}
	}
	return out
}

// specDiagnosticText is a diagnostic with its file, code and source line.
func specDiagnosticText(d *ast.Diagnostic) string {
	file, text := "", ""
	if d.File() != nil {
		file = path.Base(string(d.File().FileName()))
		src := d.File().Text()
		pos := d.Pos()
		for pos >= 0 && pos < len(src) && strings.ContainsRune(" \t\r\n", rune(src[pos])) {
			pos++
		}
		if pos >= 0 && pos <= len(src) {
			start := strings.LastIndex(src[:pos], "\n") + 1
			end := strings.Index(src[pos:], "\n")
			if end < 0 {
				end = len(src) - pos
			}
			text = fmt.Sprintf(" (line %d: %s)", strings.Count(src[:pos], "\n")+1, strings.TrimSpace(src[start:pos+end]))
		}
	}
	return fmt.Sprintf("%s %d: %s%s", file, d.Code(), d.String(), text)
}

// specObserved is a program's Outcome and trace.
type specObserved struct {
	Outcome Outcome
	Trace   json.RawMessage
}

func (s *specProgramRun) observe(file string) specObserved {
	var o specObserved
	Within("run "+file, func() {
		o.Outcome = s.node.RunObserved(s.r, file, "main")
		o.Trace = o.Outcome.Trace
	})
	return o
}

// specSameOutcome compares two runs: the kind, the error's or defect's tag, the
// success value or failure's error as JSON values, the whole ordered cause
// (Chapter 17), and the trace and coldness (Chapter 27 rule 1).
func specSameOutcome(a, b specObserved) (bool, string) {
	aspect, diff := specCompare(a, b)
	return aspect == "", diff
}

// specCompare is specSameOutcome with the aspect that differs, the part of
// a gap's key that names what disagreed: "invalid" (the outcome is not one
// of Chapter 17's), "cold" (Chapter 27 rule 1), "cause", "kind" (the
// outcome's kind or tag), "value" or "trace". It is "" when the runs agree.
func specCompare(a, b specObserved) (aspect, diff string) {
	for _, o := range []specObserved{a, b} {
		switch o.Outcome.Kind {
		case "success", "failure", "defect", "interrupt":
		default:
			return "invalid", fmt.Sprintf("invalid semantic outcome %s: %s", o.Outcome.Kind, o.Outcome.Log)
		}
		if !bytes.Equal(o.Outcome.BeforeCall, o.Outcome.AfterCall) {
			return "cold", fmt.Sprintf("export is not cold: trace before call %s, after call %s", o.Outcome.BeforeCall, o.Outcome.AfterCall)
		}
	}
	if !slices.Equal(a.Outcome.Cause, b.Outcome.Cause) {
		return "cause", fmt.Sprintf("cause %v vs %v", a.Outcome.Cause, b.Outcome.Cause)
	}
	if a.Outcome.Kind != b.Outcome.Kind || a.Outcome.Tag != b.Outcome.Tag {
		return "kind", fmt.Sprintf("outcome %s %s vs %s %s", a.Outcome.Kind, a.Outcome.Tag, b.Outcome.Kind, b.Outcome.Tag)
	}
	if a.Outcome.Kind == "success" || a.Outcome.Kind == "failure" {
		var x, y any
		if err := json.Unmarshal(a.Outcome.Value, &x); err != nil {
			return "invalid", "invalid JSON value: " + err.Error()
		}
		if err := json.Unmarshal(b.Outcome.Value, &y); err != nil {
			return "invalid", "invalid JSON value: " + err.Error()
		}
		if !reflect.DeepEqual(x, y) {
			return "value", fmt.Sprintf("value %s vs %s", a.Outcome.Value, b.Outcome.Value)
		}
	}
	if !bytes.Equal(a.Trace, b.Trace) {
		return "trace", fmt.Sprintf("trace\n%s\nvs\n%s", a.Trace, b.Trace)
	}
	return "", ""
}

// specPendingFeatures is the set of features the targets' pending lines
// name, which the generator leaves out.
func specPendingFeatures(targets ...string) map[string]bool {
	out := map[string]bool{}
	for _, target := range targets {
		for name := range PendingFeatures(target) {
			out[name] = true
		}
	}
	return out
}

// specLeaveOut is the features a target's generator leaves out for an
// input: none for a pending corpus input, which reproduces its gap with the
// features that a pending line keeps out of campaigns.
func specLeaveOut(target, key string, pending map[string]bool) map[string]bool {
	if _, ok := Pending(target, key); ok {
		return nil
	}
	return pending
}

// specCorpusKey is the pending key of the input being run: its file name in
// testdata/fuzz/<target>/ when the input is a corpus file.
func specCorpusKey(t *testing.T) string {
	return "corpus:" + path.Base(t.Name())
}

func specProgramEnv(f *testing.F) (*Workspace, *Node) {
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(f, "%v", err)
	}
	f.Cleanup(node.Close)
	return w, node
}

// specConfig is DefaultConfig with every source listed.
func specConfig(files map[string]string) string {
	var names []string
	for name := range files {
		if isSource(name) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	listed, _ := json.Marshal(names)
	return strings.TrimSuffix(DefaultConfig, "\n}") + ",\n  \"files\": " + string(listed) + "\n}"
}

func specCompile(t *testing.T, w *Workspace, files map[string]string) *Result {
	var r *Result
	var err error
	Within("compile", func() { r, err = w.Compile(t.Context(), Project{Files: files, Config: specConfig(files)}) })
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func specDump(files map[string]string) string {
	return Archive(files)
}

// numericLiterals is a union of number literals, such as "3 | 5".
var numericLiterals = regexp.MustCompile(`^-?\d+(\.\d+)?( \| -?\d+(\.\d+)?)*$`)

// successMatches reports whether a declared success type is the model's. The
// model knows only number or void; the contract's A is what TypeScript
// infers from the returned values (Chapter 14), which keeps a union of
// number literals, such as 3 | 5 for b ? 3 : 5, where the model says number.
func successMatches(declared, model string) bool {
	return declared == model || model == "number" && numericLiterals.MatchString(declared)
}

// A specMismatch is one disagreement of a declaration with the model: its
// aspect names what disagreed, "declaration" (none), "A", "stream",
// "plain", "E" or "R".
type specMismatch struct{ aspect, text string }

// contractMismatches checks A, E and R and the calling convention of every
// exported function, including producers (Chapters 2-4, 8, 14; Chapter 27),
// and returns each disagreement, so that each is a gap of its own.
func (s *specProgramRun) contractMismatches() []specMismatch {
	var out []specMismatch
	for _, fn := range s.p.Funcs {
		if !fn.Export {
			continue
		}
		moduleFile := specgen.ModuleFile("main.vibe", fn.Module)
		declarationFile := "out/" + strings.TrimSuffix(moduleFile, ".vibe") + ".d.ts"
		declared := specgen.DeclaredContracts(s.r.Outputs[declarationFile])
		d, ok := declared[fn.Name]
		add := func(aspect, format string, args ...any) {
			out = append(out, specMismatch{aspect, fmt.Sprintf(format, args...)})
		}
		switch {
		case !ok:
			add("declaration", "%s has no declaration in main.d.ts\n%s", fn.Name, s.r.Outputs[declarationFile])
		case !successMatches(d.A, specgen.SuccessType(fn)):
			add("A", "%s declares A=%s; the specification infers A=%s\n%s", fn.Name, d.A, specgen.SuccessType(fn), Archive(s.r.Sources))
		case fn.Producer() && !d.Stream:
			add("stream", "%s is a producer, but main.d.ts does not declare a Stream\n%s", fn.Name, Archive(s.r.Sources))
		case !fn.Producer() && d.Stream:
			add("stream", "%s is a function, but main.d.ts declares a Stream\n%s", fn.Name, Archive(s.r.Sources))
		case fn.Annot == "plain":
			if !d.Plain {
				add("plain", "%s has a plain return annotation, but main.d.ts declares an Effect\n%s", fn.Name, Archive(s.r.Sources))
			}
		case d.Plain:
			add("plain", "%s is an Effect function, but main.d.ts declares a plain return type\n%s", fn.Name, Archive(s.r.Sources))
		default:
			wantE, gotE := specgen.NormalizeErrors(s.p, fn.E), specgen.NormalizeErrors(s.p, d.E)
			if !wantE.Equal(gotE) {
				add("E", "%s declares E=%v; the specification infers E=%v\n%s", fn.Name, gotE.Sorted(), wantE.Sorted(), Archive(s.r.Sources))
			}
			if !fn.R.Equal(d.R) {
				add("R", "%s declares R=%v; the specification infers R=%v\n%s", fn.Name, d.R.Sorted(), fn.R.Sorted(), Archive(s.r.Sources))
			}
		}
	}
	return out
}

// specGaps collects one input's disagreements with the specification. Each
// gap is keyed by the oracle that found it and what disagreed:
//
//   - "compile:<code>": a valid program, its Effect reading or a variant
//     draws an error (Ch 27), one gap per code, such as compile:TS2339;
//   - "reference:<aspect>": VibeLang and its Effect reading end differently
//     (Ch 1, Appendix C, D266), by specCompare's aspect;
//   - "contract:<aspect>": a declaration disagrees with the model (Ch 2-4,
//     Ch 14, Ch 27 rule 4), by contractMismatches' aspect: A, E, R, ...;
//   - "variant:<name>:<aspect>": a variant ends differently from the base
//     print.
//
// A key may name the generator or variant feature the gap needs, after a
// slash, as compile:TS1109/do-match-value: the pending line names the gap
// precisely, and a new disagreement of an input that holds the feature still
// fails. A corpus line never excuses a gap: it only marks its reproduction,
// which fails as XPASS once every oracle holds.
type specGaps struct {
	t      *testing.T
	target string
	found  []specGap
}

type specGap struct{ target, key, text string }

// add records a gap under key, or under key/<feature> for the first of
// features whose key a pending line lists. A gap of the base print in
// FuzzSpecVariants is FuzzSpecPrograms' too: the variants' generator leaves
// out the features of both targets' pending lines, so a base-print gap that
// FuzzSpecPrograms lists is pending here.
func (g *specGaps) add(key string, features []string, format string, args ...any) {
	text := fmt.Sprintf(format, args...)
	targets := []string{g.target}
	if g.target == specTargetVariants {
		targets = append(targets, specTargetPrograms)
	}
	for _, f := range features {
		for _, target := range targets {
			if _, ok := Pending(target, key+"/"+f); ok {
				g.found = append(g.found, specGap{target, key + "/" + f, text})
				return
			}
		}
	}
	for _, target := range targets {
		if _, ok := Pending(target, key); ok {
			g.found = append(g.found, specGap{target, key, text})
			return
		}
	}
	g.found = append(g.found, specGap{g.target, key, text})
}

// finish fails on each gap no pending line lists and skips when every gap
// is pending. With no gap, a pending reproduction fails as XPASS when
// final is set.
func (g *specGaps) finish(key string, final bool) {
	g.t.Helper()
	if len(g.found) == 0 {
		if final {
			ExpectPending(g.t, g.target, key)
		}
		return
	}
	var pending []string
	failed := false
	for _, f := range g.found {
		if entry, ok := Pending(f.target, f.key); ok {
			pending = append(pending, fmt.Sprintf("%s %s (%s: %s)", f.target, f.key, entry.Owner, entry.Reason))
			continue
		}
		failed = true
		g.t.Errorf("%s %s: %s", f.target, f.key, f.text)
	}
	if failed {
		g.t.FailNow()
	}
	g.t.Skipf("pending: %s", strings.Join(pending, "; "))
}

// specUsed is the sorted features a program holds.
func specUsed(p *specgen.Program) []string {
	var used []string
	for name, ok := range p.Used {
		if ok {
			used = append(used, name)
		}
	}
	slices.Sort(used)
	return used
}

// specVariantFeatures maps each variant's file to the variant features of
// FuzzSpecVariants' pending lines that its print holds: those whose leaving
// out changes its source.
func specVariantFeatures(p *specgen.Program, variants []specgen.Variant, leaveOut map[string]bool) map[string][]string {
	entries, err := pendingEntries()
	if err != nil {
		panic(err)
	}
	out := map[string][]string{}
	for _, e := range entries {
		name, ok := strings.CutPrefix(e.Key, "feature:")
		if !ok || e.Target != specTargetVariants || leaveOut[name] {
			continue
		}
		without := map[string]bool{name: true}
		for k, v := range leaveOut {
			without[k] = v
		}
		for _, v := range specgen.Variants(p, p.Rest, without) {
			for _, u := range variants {
				if u.Name == v.Name && u.Source != v.Source {
					out["v_"+u.Name+".vibe"] = append(out["v_"+u.Name+".vibe"], name)
				}
			}
		}
	}
	return out
}

// compileGaps records a gap for each error code, with the features of the
// file that reports it: its variant features, then the program's.
func (s *specProgramRun) compileGaps(g *specGaps, files map[string]string, fileFeatures map[string][]string) {
	seen := map[string]bool{}
	for _, d := range s.errorDiagnostics() {
		file := ""
		if d.File() != nil {
			file = path.Base(string(d.File().FileName()))
		}
		code := diagnosticKey(d)
		if seen[file+" "+code] {
			continue
		}
		seen[file+" "+code] = true
		features := slices.Concat(fileFeatures[file], specUsed(s.p))
		g.add("compile:"+code, features, "a valid program does not compile (focus %s): %s\n%s\n%s", s.p.Focus, specDiagnosticText(d), strings.Join(s.errors(), "\n"), specDump(files))
	}
}

// FuzzSpecPrograms generates a program, compiles its VibeLang and Effect
// prints together, and requires no error, the same Outcome and trace, and
// the declared contracts the model infers.
func FuzzSpecPrograms(f *testing.F) {
	startShortBudget(f)
	SkipRetired(f, specTargetPrograms)
	for _, seed := range specProgramSeeds() {
		f.Add(seed)
	}
	w, node := specProgramEnv(f)
	pending := specPendingFeatures(specTargetPrograms)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := specCorpusKey(t)
		p := specgen.Generate(data, specLeaveOut(specTargetPrograms, key, pending))
		files := specgen.PrintVibeFiles(p, specgen.VibeOptions{}, "main.vibe")
		files["ref.ts"] = specgen.PrintEffect(p)
		r := specCompile(t, w, files)
		defer r.Remove()
		s := &specProgramRun{t: t, w: w, node: node, r: r, p: p}
		g := &specGaps{t: t, target: specTargetPrograms}
		used := specUsed(p)
		// Ch 27: the generator writes only programs the specification
		// accepts, so any error is the compiler's, or the generator's bug.
		s.compileGaps(g, files, nil)
		g.finish(key, false)
		ref := s.observe("out/ref.js")
		if ok, diff := specSameOutcome(ref, ref); !ok {
			t.Fatalf("the reference print violates the model: %s\n%s", diff, specDump(files))
		}
		got := s.observe("out/main.js")
		if aspect, diff := specCompare(ref, got); aspect != "" {
			g.add("reference:"+aspect, used, "VibeLang and its Effect reading end differently (focus %s): %s\n%s\n%s", p.Focus, diff, got.Outcome.Log, specDump(files))
		}
		// Ch 2-4, Ch 14 and Ch 27 rules 1 and 4: the declaration of an
		// exported function writes its inferred contract as
		// Effect.Effect<A, E, R>, and a function with a plain return
		// annotation stays a plain function.
		for _, m := range s.contractMismatches() {
			g.add("contract:"+m.aspect, used, "%s", m.text)
		}
		g.finish(key, true)
	})
}

// FuzzSpecVariants compiles a program's base print, its metamorphic variants
// and its Effect reading in one project, and requires every variant to end as
// the base does.
func FuzzSpecVariants(f *testing.F) {
	startShortBudget(f)
	SkipRetired(f, specTargetVariants)
	for _, seed := range specVariantSeeds() {
		f.Add(seed)
	}
	w, node := specProgramEnv(f)
	pending := specPendingFeatures(specTargetVariants, specTargetPrograms)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := specCorpusKey(t)
		leaveOut := specLeaveOut(specTargetVariants, key, pending)
		p := specgen.Generate(data, leaveOut)
		variants := specgen.Variants(p, p.Rest, leaveOut)
		files := specgen.PrintVibeFiles(p, specgen.VibeOptions{}, "main.vibe")
		files["ref.ts"] = specgen.PrintEffect(p)
		for _, v := range variants {
			files["v_"+v.Name+".vibe"] = v.Source
		}
		r := specCompile(t, w, files)
		defer r.Remove()
		s := &specProgramRun{t: t, w: w, node: node, r: r, p: p}
		g := &specGaps{t: t, target: specTargetVariants}
		used := specUsed(p)
		fileFeatures := specVariantFeatures(p, variants, leaveOut)
		s.compileGaps(g, files, fileFeatures)
		g.finish(key, false)
		base := s.observe("out/main.js")
		ref := s.observe("out/ref.js")
		if ok, diff := specSameOutcome(ref, ref); !ok {
			t.Fatalf("the reference print violates the model: %s\n%s", diff, specDump(files))
		}
		if aspect, diff := specCompare(ref, base); aspect != "" {
			g.add("reference:"+aspect, used, "VibeLang and its Effect reading end differently (focus %s): %s\n%s", p.Focus, diff, specDump(files))
		}
		for _, v := range variants {
			got := s.observe("out/v_" + v.Name + ".js")
			if aspect, diff := specCompare(base, got); aspect != "" {
				features := slices.Concat(fileFeatures["v_"+v.Name+".vibe"], used)
				g.add("variant:"+v.Name+":"+aspect, features, "variant %s (%s) ends differently from the base print: %s\n%s\n%s", v.Name, v.Spec, diff, got.Outcome.Log, specDump(files))
			}
		}
		g.finish(key, true)
	})
}

// TestGeneratorCoversFeatures proves that the generator can write every
// named feature: the one-byte input that focuses on a feature holds it.
func TestGeneratorCoversFeatures(t *testing.T) {
	SkipRetired(t, specTargetPrograms)
	for i, f := range specgen.Features {
		p := specgen.Generate([]byte{byte(i)}, nil)
		if p.Focus != f.Name {
			t.Errorf("input %d focuses on %s, not %s", i, p.Focus, f.Name)
		}
		if !p.Used[f.Name] {
			t.Errorf("the input that focuses on %s does not hold it", f.Name)
		}
	}
	// Every seed is deterministic: equal bytes, equal programs.
	for _, seed := range specProgramSeeds() {
		a := specgen.Generate(seed, nil)
		b := specgen.Generate(seed, nil)
		if specgen.PrintVibe(a, specgen.VibeOptions{}) != specgen.PrintVibe(b, specgen.VibeOptions{}) || specgen.PrintEffect(a) != specgen.PrintEffect(b) {
			t.Fatalf("seed %x prints two programs", seed)
		}
	}
	for name := range specPendingFeatures(specTargetPrograms) {
		if specgen.FeatureIndex(name) >= 0 {
			t.Logf("pending: %s", name)
		}
	}
}

// specFormFeatures maps each row of SKILL.md's Forms table, by every code
// span of its VibeLang column, to the generator feature that writes it, or to
// a feature name the pending file lists as not generated, with the reason.
var specFormFeatures = map[string]string{
	"error E { id: string }": "throw",
	"error E { id: string; constructor(raw: string) { super({ id: raw.trim() }) } }": "custom-error-constructor",
	"schema error E { id: string }": "schema-error",
	"service Users { static readonly key = \"app/Users\"; find(id: string): User!NotFound; region: string }": "service",
	"key":                    "service",
	"service Prefix: string": "service-shape",
	"schema User { id: string; nick?: string; role: \"admin\" | \"member\"; home: Address }": "schema",
	"schema Code = \"a\" | \"b\"":                                "schema",
	"data Delivery { Waiting; Sent { tracking: string } }":       "match-data",
	"mutable count: number":                                      "mutable-members",
	"Layer.effect(Users) { setup; return { find(id) { ... } } }": "layer-effect",
	"Users.find(id)":                                             "service",
	"provide AppLive { ... }":                                    "provide-local",
	"throw new E({ id })":                                        "throw",
	"try { ... } catch (e) { return match (e) { when E: ...; default: throw e; } }": "match-error",
	"p catch (e) => f(e)": "catch-handler",
	"match (exit(p)) { when Exit.Success(let v): v; when Exit.Failure(let cause): ...; }": "match-exit",
	"try { } finally { }": "try-finally",
	"using r = Effect.acquireRelease(() => open(), (r) => close(r))": "using",
	"function f() { return withSpan(() => { ... }, \"name\") }":      "spans",
	"withSpan(() => p(), \"n\")":                                     "spans",
	"{":                                                              "test-block-param", // a block param's brace on the next line is EK1022 (S2)
	"Users":                                                          "service-identity",
	"Users.Shape":                                                    "service-identity",
	"timeout(() => retry(() => p(), s), t)":                          "timeout-retry",
	"match (x) { when \"a\": 1; when E and { let id }: id; default: 0; }": "match-literal",
	"when Option.Some(let v):":                "match-option",
	"when Delivery.Sent { let tracking }:":    "match-data",
	"const f = fork work()":                   "fork-join",
	"fork { ... }":                            "fork-block",
	"await.all [a(), b()]":                    "await-all",
	"await.allSettled [a(), b()]":             "await-allsettled",
	"await.race [a(), b()]":                   "await-race",
	"for concurrent(8) (const x of xs) f(x)":  "for-concurrent",
	"uninterruptible { ... restore { ... } }": "uninterruptible",
	"function*":                               "producer",
	"sync(() => f())":                         "hatch-sync",
	"try Effect.try({ try: () => JSON.parse(text), catch: (e) => new Bad({ e }) })":                      "hatch-try",
	"callback((resume) => { socket.once(\"open\", resume); return () => socket.off(\"open\", resume) })": "callback-hatch",
	"import \"vibelang/platform/node\"":                                "platform-entry",
	"control Approval { approve(r: string): boolean!! }":               "control-resume",
	"module text { export function clean(s: string): string { ... } }": "module-block",
	"error Timeout": "throw",
	"error Sub extends Base { path: string }":      "error-family",
	"service Search: SearchApi { static members }": "service-shape",
	"Search":                            "service-shape",
	"SearchApi":                         "service-shape",
	"Delivery.Waiting()":                "match-data",
	"Delivery.Sent({ tracking })":       "match-data",
	"data LoadState<A, E> { ... }":      "generic-data",
	"Layer.succeed(Users, { ... })":     "layer-succeed",
	"Users()":                           "service-impl",
	"provide Random = seeded { ... }":   "provide-key",
	"provide A, Key = v { }":            "provide-local",
	"x ?? throw new E({ id })":          "throw-expression",
	"p catch v":                         "catch-value",
	"Effect.failCause(cause)":           "fail-cause",
	"throw cause":                       "throw-cause-invalid",
	"try { } finally (exit) { }":        "finally-exit",
	"it.effect(\"n\") { ... }":          "test-block-param",
	"|>":                                "pipe",
	"retry":                             "retry",
	"when Option.None:":                 "match-option",
	"if (o is Exit.Failure(let cause))": "is-exit",
	"when Delivery.Waiting:":            "match-data",
	"if (d is Delivery.Sent)":           "is-data",
	"join f":                            "fork-join",
	"join [a, b]":                       "join-array",
	"detach(p)":                         "fork-detach",
	"forkIn(scope, p)":                  "fork-in",
	"Effect.forkScoped(p)":              "fork-scoped",
	"Scope":                             "fork-scoped",
	"await.all { x: a(), y: b() }":      "await-all-record",
	"Result":                            "await-allsettled",
	"await.any [...]":                   "await-any",
	"interruptible { ... }":             "interruptible",
	"yield":                             "producer",
	"for (const x of p())":              "producer",
	"sync(f())":                         "hatch-sync",
	"sync(async () => load())":          "hatch-promise",
	"try Effect.tryPromise({ try: (signal) => sdk.get(id, { signal }), catch: (e) => new Bad({ e }) })": "hatch-try-promise",
	"export function main() { ... }": "platform-entry",
	"export const main = () => …":    "platform-entry",
	"EK4843":                         "platform-entry",
	"try { ... } handle Approval.approve(r) { resume(true) }": "control-resume",
	"import { clean } from text":                              "module-block",
}

var specCodeSpan = regexp.MustCompile("`([^`]+)`")

// TestGeneratorMatchesSpecForms reads SKILL.md's Forms table at test time and
// checks that every code span maps to a generator feature, or to a pending line
// that says why the generator leaves it out.
func TestGeneratorMatchesSpecForms(t *testing.T) {
	SkipRetired(t, specTargetPrograms)
	data, err := os.ReadFile(filepath.Join(Root(), "packages/compiler/skills/vibelang/SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	start := strings.Index(text, "| Effect TypeScript | VibeLang |")
	if start < 0 {
		t.Fatal("SKILL.md has no Forms table")
	}
	pending := specPendingFeatures(specTargetPrograms)
	listed := map[string]bool{}
	rows := 0
	for _, line := range strings.Split(text[start:], "\n")[2:] {
		if !strings.HasPrefix(line, "|") {
			break
		}
		cells := specSplitRow(line)
		if len(cells) < 2 {
			continue
		}
		rows++
		spans := specCodeSpan.FindAllStringSubmatch(cells[1], -1)
		if len(spans) == 0 {
			t.Errorf("row without a VibeLang form: %s", line)
		}
		for _, span := range spans {
			form := strings.ReplaceAll(span[1], `\|`, "|")
			listed[form] = true
			feature, ok := specFormFeatures[form]
			if !ok {
				t.Errorf("SKILL.md form %q maps to no generator feature: add it to specFormFeatures", form)
				continue
			}
			if specgen.FeatureIndex(feature) < 0 && !pending[feature] {
				t.Errorf("SKILL.md form %q maps to %q, which is neither a generator feature nor a pending line of %s", form, feature, specTargetPrograms)
			}
		}
	}
	if rows < 30 {
		t.Errorf("read %d rows from SKILL.md's Forms table", rows)
	}
	for form := range specFormFeatures {
		if !listed[form] {
			t.Errorf("specFormFeatures maps %q, which SKILL.md's Forms table no longer lists", form)
		}
	}
}

// specSplitRow splits a Markdown table row on unescaped pipes outside code spans.
func specSplitRow(line string) []string {
	var cells []string
	var b strings.Builder
	code := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '\\' && i+1 < len(line) && line[i+1] == '|':
			b.WriteString(`\|`)
			i++
		case ch == '`':
			code = !code
			b.WriteByte(ch)
		case ch == '|' && !code:
			cells = append(cells, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteByte(ch)
		}
	}
	if len(cells) > 0 {
		cells = cells[1:] // the text before the first pipe
	}
	return cells
}

// TestSpecProgramDir compiles and runs the program in the directory that
// VIBELANG_FUZZ_PROGRAM_DIR names, or the generated program of the hex input
// VIBELANG_FUZZ_PROGRAM_HEX, for debugging by hand.
func TestSpecProgramDir(t *testing.T) {
	files := map[string]string{}
	hex := os.Getenv("VIBELANG_FUZZ_PROGRAM_HEX")
	if seed := os.Getenv("VIBELANG_FUZZ_SEED"); seed != "" {
		hex = specSeedHex(seed)
	}
	if hex != "" {
		var data []byte
		fmt.Sscanf(hex, "%x", &data)
		p := specgen.Generate(data, specPendingFeatures(specTargetPrograms, specTargetVariants))
		files = specgen.PrintVibeFiles(p, specgen.VibeOptions{}, "main.vibe")
		files["ref.ts"] = specgen.PrintEffect(p)
		for _, v := range specgen.Variants(p, p.Rest, nil) {
			files["v_"+v.Name+".vibe"] = v.Source
		}
	} else if dir := os.Getenv("VIBELANG_FUZZ_PROGRAM_DIR"); dir != "" {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries {
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			files[e.Name()] = string(data)
		}
	} else {
		t.Skip("set VIBELANG_FUZZ_PROGRAM_DIR or VIBELANG_FUZZ_PROGRAM_HEX")
	}
	w := NewWorkspace(t)
	r, err := w.Compile(t.Context(), Project{Files: files, Config: specConfig(files)})
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range r.Diagnostics {
		t.Logf("diagnostic %s", specDiagnosticText(d))
	}
	show := os.Getenv("VIBELANG_FUZZ_SHOW")
	for name, text := range files {
		if strings.Contains(show, name) {
			t.Logf("== %s ==\n%s", name, text)
		}
	}
	for name, text := range r.Outputs {
		if strings.Contains(show, name) {
			t.Logf("== %s ==\n%s", name, text)
		}
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(t, "%v", err)
	}
	defer node.Close()
	for name := range files {
		if !isSource(name) {
			continue
		}
		js := "out/" + strings.TrimSuffix(strings.TrimSuffix(name, ".vibe"), ".ts") + ".js"
		got := node.Run(r, js, "main")
		trace := node.Run(r, js, "traceOf")
		t.Logf("%s main: %s %s %s\n%s\ntrace: %s", name, got.Kind, got.Tag, got.Value, got.Log, trace.Value)
	}
}

// specSeedHex is the hex of seed number seed of FuzzSpecPrograms, or of
// FuzzSpecVariants when it starts with "v", as -short or not chooses them.
func specSeedHex(seed string) string {
	seeds := specProgramSeeds()
	if rest, ok := strings.CutPrefix(seed, "v"); ok {
		seed, seeds = rest, specVariantSeeds()
	}
	var i int
	fmt.Sscanf(seed, "%d", &i)
	return fmt.Sprintf("%x", seeds[i])
}

// TestSpecMinimize shrinks the generator input VIBELANG_FUZZ_PROGRAM_HEX
// while the failure VIBELANG_FUZZ_MINIMIZE names persists: "diag:<code>" for
// an error diagnostic of that code, "mismatch" for VibeLang and its Effect
// reading ending differently, or "variant:<name>" for a variant ending
// differently from the base print, or "variant:<name>:diag:<code>" for an
// error in that variant. It logs the smallest input and its program, for a
// corpus file. VIBELANG_FUZZ_MINIMIZE_LEAVE=pending leaves out the pending
// features, as a seed or campaign input does; a corpus reproduction leaves
// out none, so check the result without it before saving it.
func TestSpecMinimize(t *testing.T) {
	hex, want := os.Getenv("VIBELANG_FUZZ_PROGRAM_HEX"), os.Getenv("VIBELANG_FUZZ_MINIMIZE")
	if seed := os.Getenv("VIBELANG_FUZZ_SEED"); seed != "" {
		hex = specSeedHex(seed)
	}

	if corpus := os.Getenv("VIBELANG_FUZZ_CORPUS"); corpus != "" {
		contents, err := os.ReadFile(corpus)
		if err != nil {
			t.Fatal(err)
		}
		line := strings.TrimSpace(strings.TrimPrefix(string(contents), "go test fuzz v1\n"))
		decoded, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(line, "[]byte("), ")"))
		if err != nil {
			t.Fatal(err)
		}
		hex = fmt.Sprintf("%x", []byte(decoded))
	}
	if hex == "" || want == "" {
		t.Skip("set VIBELANG_FUZZ_PROGRAM_HEX (or VIBELANG_FUZZ_SEED) and VIBELANG_FUZZ_MINIMIZE")
	}
	var data []byte
	fmt.Sscanf(hex, "%x", &data)
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		Missing(t, "%v", err)
	}
	defer node.Close()
	var leaveOut map[string]bool
	if os.Getenv("VIBELANG_FUZZ_MINIMIZE_LEAVE") == "pending" {
		leaveOut = specPendingFeatures(specTargetPrograms, specTargetVariants)
	}
	fails := func(data []byte) bool {
		p := specgen.Generate(data, leaveOut)
		files := specgen.PrintVibeFiles(p, specgen.VibeOptions{}, "main.vibe")
		files["ref.ts"] = specgen.PrintEffect(p)
		variant, isVariant := strings.CutPrefix(want, "variant:")
		want := want
		if isVariant {
			if name, diag, ok := strings.Cut(variant, ":"); ok {
				variant, want = name, diag
			}
			for _, v := range specgen.Variants(p, p.Rest, leaveOut) {
				if v.Name == variant {
					files["v.vibe"] = v.Source
				}
			}
			if files["v.vibe"] == "" {
				return false
			}
		}
		r := specCompile(t, w, files)
		defer r.Remove()
		s := &specProgramRun{t: t, w: w, node: node, r: r, p: p}
		errs := s.errors()
		if code, ok := strings.CutPrefix(want, "diag:"); ok {
			for _, e := range errs {
				if strings.Contains(e, " "+code+": ") && (!isVariant || strings.HasPrefix(e, "v.vibe ")) {
					return true
				}
			}
			return false
		}
		if len(errs) > 0 {
			return false
		}
		if want == "contract-a" {
			return slices.ContainsFunc(s.contractMismatches(), func(m specMismatch) bool { return m.aspect == "A" })
		}
		a := s.observe("out/ref.js")
		if isVariant {
			a = s.observe("out/main.js")
		}
		var b specObserved
		if isVariant {
			b = s.observe("out/v.js")
		} else {
			b = s.observe("out/main.js")
		}
		ok, _ := specSameOutcome(a, b)
		refValid, _ := specSameOutcome(a, a)
		return !ok && refValid
	}
	if !fails(data) {
		t.Fatalf("the input does not fail with %s", want)
	}
	for changed := true; changed; {
		changed = false
		for size := len(data) / 2; size >= 1; size /= 2 {
			for at := 0; at+size <= len(data); {
				cand := append(append([]byte{}, data[:at]...), data[at+size:]...)
				if fails(cand) {
					data, changed = cand, true
				} else {
					at += size
				}
			}
		}
		for i := range data {
			for _, b := range []byte{0, data[i] / 2, data[i] - 1} {
				if b >= data[i] {
					continue
				}
				cand := append([]byte{}, data...)
				cand[i] = b
				if fails(cand) {
					data, changed = cand, true
					break
				}
			}
		}
	}
	p := specgen.Generate(data, leaveOut)
	shown := specgen.PrintVibe(p, specgen.VibeOptions{})
	if variant, ok := strings.CutPrefix(want, "variant:"); ok {
		variant, _, _ = strings.Cut(variant, ":")
		for _, v := range specgen.Variants(p, p.Rest, leaveOut) {
			if v.Name == variant {
				shown += "-- variant " + v.Name + " --\n" + v.Source
			}
		}
	}
	t.Logf("minimized to %d bytes: %x\ncorpus line: []byte(%q)\n%s", len(data), data, data, shown)
}
