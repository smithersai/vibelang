package vibelangfuzz

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// FuzzTypeScriptParity compiles projects of ordinary TypeScript sources with
// the fork and with the stock TypeScript 7 that packages/ts-mapper pins, and
// holds the fork to D266: "ordinary TypeScript sources keep TypeScript
// diagnostics whatever these settings say" (Chapter 28), and the compiler is
// "the TypeScript 7.1 checker, with ordinary TypeScript semantics for .ts
// files (D30)". The two must report the same diagnostic codes at the same
// positions, including diagnostic ends, and emit the same JavaScript,
// declarations and source maps.
func FuzzTypeScriptParity(f *testing.F) {
	startShortBudget(f)
	tsc := StockTypeScript(f)
	w := NewWorkspace(f)
	for _, seed := range ParitySeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, archive string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		CheckParity(t, w, tsc, "FuzzTypeScriptParity", archive)
	})
}

// StockTypeScript returns the stock tsc that packages/ts-mapper/package.json
// pins, installed as CONTRIBUTING.md says, or skips with the command that
// installs it (fails under VIBELANG_FUZZ_REQUIRE=1). TS7_VERSION overrides the version, as for the mapper's tests.
func StockTypeScript(tb testing.TB) string {
	tb.Helper()
	tsc, err := stockTypeScript()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			Missing(tb, "%v", err)
		}
		tb.Fatal(err)
	}
	return tsc
}

// ParitySeeds are the TypeScript sources of the acceptance cases, each
// case's top level with its tsconfig.json, and each declaration-identity
// case's typescript/ project with its own.
var ParitySeeds = sync.OnceValue(func() []string {
	var seeds []string
	for _, seed := range shortWitnessSeeds(parityInputs(), 32) {
		seeds = append(seeds, Archive(seed.Files))
	}
	return seeds
})

// Sample actual distinct parity projects, after removing VibeLang-only cases.
func parityInputs() []Seed {
	var seeds []Seed
	seen := map[string]int{}
	for _, seed := range CaseSeeds() {
		for _, prefix := range []string{"", "typescript/"} {
			files := map[string]string{}
			sources := 0
			for name, text := range seed.Files {
				rest, ok := strings.CutPrefix(name, prefix)
				if !ok || prefix == "" && strings.HasPrefix(name, "typescript/") {
					continue
				}
				if isTypeScript(rest) || strings.HasSuffix(rest, ".json") {
					files[rest] = withoutVibe(text)
					if rest == "tsconfig.json" {
						files[rest] = withEmitters(files[rest])
					}
				}
				if isTypeScript(rest) && !isDeclaration(rest) {
					sources++
				}
			}
			if sources == 0 {
				continue
			}
			archive := Archive(files)
			if index, ok := seen[archive]; ok {
				if seed.Pending != "" {
					seeds[index].Pending = seed.Pending
				}
				continue
			}
			seen[archive] = len(seeds)
			seeds = append(seeds, Seed{Name: seed.Name + " " + prefix, Files: files, Pending: seed.Pending})
			seedNames.LoadOrStore(archive, "case "+seed.Name+" "+prefix)
		}
	}
	return seeds
}

var vibeEntry = regexp.MustCompile(`"[^"\n]*\.vibe"\s*,?\s*`)
var trailingComma = regexp.MustCompile(`,(\s*\])`)

// withoutVibe drops the .vibe entries of a configuration's file lists, so
// that a case's tsconfig.json describes its TypeScript sources alone.
func withoutVibe(text string) string {
	return trailingComma.ReplaceAllString(vibeEntry.ReplaceAllString(text, ""), "$1")
}

func isTypeScript(name string) bool {
	return isSource(name) && !strings.HasSuffix(name, ".vibe")
}

var stockDiagnostic = regexp.MustCompile(`^(?:(.+)\((\d+),(\d+)\): )?(error|warning|message) TS(\d+): `)

// CheckParity runs FuzzTypeScriptParity's oracles on one input.
func CheckParity(t *testing.T, w *Workspace, tsc, target, archive string) {
	project := ProjectFromArchive(archive)
	for name := range project.Files {
		if !isTypeScript(name) && !strings.HasSuffix(name, ".json") {
			delete(project.Files, name) // a .vibe source is not ordinary TypeScript
		}
	}
	if reason := Admissible(project); reason != "" {
		t.Skip(reason)
	}
	// A compilerOptions.vibelang block is the fork's own option, which stock
	// TypeScript rejects as unknown (D275).
	if strings.Contains(project.Config, `"vibelang"`) {
		t.Skip("VibeLang settings")
	}
	// A project that names a .vibe file, in its configuration or in an
	// import, is not ordinary TypeScript: stock TypeScript cannot read the
	// file, and D365 writes a relative .vibe specifier with its output's .js
	// name in every importer, a .ts file's included.
	for name, text := range project.Files {
		if strings.Contains(text, ".vibe") {
			t.Skipf("%s names a .vibe file", name)
		}
	}
	if strings.Contains(project.Config, ".vibe") {
		t.Skip("the configuration names .vibe files")
	}
	if !slices.ContainsFunc(mapKeys(project.Files), func(name string) bool { return isTypeScript(name) && !isDeclaration(name) }) {
		t.Skip("no TypeScript source")
	}
	g := &Gaps{Target: target, Input: SeedName(archive)}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
	}
	defer recoverCompilerPanic(t, target)
	var fork *Compilation
	var err error
	within(t, "compile", func() { fork, err = w.CompileOrdered(t.Context(), project, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	defer fork.Remove()
	// tsc prints what GetDiagnosticsOfAnyProgram returns before it emits,
	// which stops after syntax errors, then what emit returns. The fork's
	// program has emitted, and the checker adds diagnostics while emit asks it
	// about names (TS2552 at `kin` in `{ kin = Sc }`), which tsc never prints,
	// so a fresh program of the same files is asked, before stock tsc writes
	// its outputs beside them.
	reported := fork.Diagnostics
	if fork.Program != nil {
		within(t, "diagnostics", func() {
			fresh := w.programIn(fork.Dir, true).Program
			reported = slices.Concat(compiler.GetDiagnosticsOfAnyProgram(t.Context(), fresh, nil, false, fresh.GetBindDiagnostics, fresh.GetSemanticDiagnostics), fork.EmitDiagnostics)
		})
	}

	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = fork.Dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Skipf("stock tsc did not finish: %v", ctx.Err())
	}
	if exit, ok := runErr.(*exec.ExitError); runErr != nil && (!ok || exit.ExitCode() > 2) {
		t.Skipf("stock tsc failed to run: %v\n%s", runErr, out)
	}

	// D266: the same diagnostics, by file, position, category and code.
	var stock, ours []string
	for line := range strings.SplitSeq(string(out), "\n") {
		if m := stockDiagnostic.FindStringSubmatch(line); m != nil {
			stock = append(stock, formatParity(m[1], m[2], m[3], m[4], m[5]))
		}
	}
	// tsc sorts what it prints and removes duplicates.
	reported = compiler.SortAndDeduplicateDiagnostics(reported)
	for _, d := range reported {
		ours = append(ours, parityLine(fork.Dir, d))
	}
	slices.Sort(stock)
	slices.Sort(ours)
	if !slices.Equal(stock, ours) {
		g.Add("feature:d266-diagnostics", "D266: the fork and stock TypeScript report different diagnostics:\n  fork:  %v\n  stock: %v\nstock tsc printed:\n%.600s", onlyIn(ours, stock), onlyIn(stock, ours), out)
	}

	// D266 preserves diagnostic ends too. The CLI prints only starts; the
	// installed stock compiler's API supplies complete UTF-16 spans, into the
	// text Node decoded from the file's bytes.
	var sourceNames []string
	for name := range project.Files {
		if isTypeScript(name) && fork.SourceFile(name) != nil {
			sourceNames = append(sourceNames, name)
		}
	}
	slices.Sort(sourceNames)
	spans, sourceOnly, spanErr := stockSpans(ctx, tsc, fork.Dir, sourceNames...)
	if spanErr != nil {
		t.Fatalf("cannot compare D266 diagnostic ends: %v", spanErr)
	}
	var forkSpans []stockSpan
	for _, d := range compiler.SortAndDeduplicateDiagnostics(fork.Diagnostics) {
		span := stockSpan{Code: d.Code(), Category: d.Category().Name()}
		if sourceOnly {
			if d.File() == nil {
				continue
			}
			relative, _ := filepath.Rel(fork.Dir, string(d.File().FileName()))
			if !slices.Contains(sourceNames, filepath.ToSlash(relative)) {
				continue
			}
		}
		if d.File() != nil {
			span.File, _ = filepath.Rel(fork.Dir, string(d.File().FileName()))
			span.File = filepath.ToSlash(span.File)
			text := d.File().Text()
			span.Start = DecodedUTF16Len(text[:d.Pos()])
			span.End = DecodedUTF16Len(text[:d.End()])
		}
		forkSpans = append(forkSpans, span)
	}
	if a, b := spanStrings(forkSpans), spanStrings(spans); !slices.Equal(a, b) {
		g.Add("feature:d266-diagnostic-spans", "D266: the fork and stock TypeScript report different complete diagnostic spans:\n  fork: %v\n  stock: %v", onlyIn(a, b), onlyIn(b, a))
	}

	// D266 and Chapter 27: ordinary TypeScript keeps the same JavaScript,
	// declarations and maps, including declaration maps when requested.
	written := map[string]string{}
	_ = filepath.WalkDir(fork.Dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := filepath.ToSlash(strings.TrimPrefix(p, fork.Dir+string(filepath.Separator)))
		if _, input := project.Files[rel]; input || rel == "tsconfig.json" || !parityOutput(rel) {
			return nil
		}
		data, err := os.ReadFile(p)
		if err == nil {
			written[rel] = string(data)
		}
		return nil
	})
	emitted := map[string]string{}
	for name, text := range fork.Outputs {
		if parityOutput(name) {
			emitted[name] = text
		}
	}
	if diff := DiffOutputs(fork.Dir, emitted, fork.Dir, written); diff != "" {
		g.Add("feature:d266-emit", "D266: the fork (first) and stock TypeScript (second) emit different JavaScript, declarations or maps:\n%s", diff)
	}
	g.FinishInput(t, key)
}

func formatParity(file, line, column, category, code string) string {
	if file == "" {
		return fmt.Sprintf("%s TS%s", category, code)
	}
	return fmt.Sprintf("%s(%s,%s): %s TS%s", filepath.ToSlash(file), line, column, category, code)
}

func parityLine(dir string, d *ast.Diagnostic) string {
	code := fmt.Sprint(d.Code())
	category := d.Category().Name()
	if d.File() == nil {
		return formatParity("", "", "", category, code)
	}
	name, err := filepath.Rel(dir, string(d.File().FileName()))
	if err != nil {
		name = string(d.File().FileName())
	}
	line, column := LineAndColumn(d)
	return formatParity(name, fmt.Sprint(line), fmt.Sprint(column), category, code)
}

// onlyIn returns the lines of a that b lacks, as multisets.
func onlyIn(a, b []string) []string {
	rest := slices.Clone(b)
	var only []string
	for _, line := range a {
		if i := slices.Index(rest, line); i >= 0 {
			rest = slices.Delete(rest, i, i+1)
		} else {
			only = append(only, line)
		}
	}
	return only
}

// parityOutput includes every public emitter that ordinary TypeScript selects
// in the shared configuration (D266, Chapter 27).
func parityOutput(name string) bool {
	return isJS(name) || isDeclaration(name) || strings.HasSuffix(name, ".map")
}
