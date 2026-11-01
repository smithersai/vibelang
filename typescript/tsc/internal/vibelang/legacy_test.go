package vibelang

import (
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestLegacyMigrationFixScope(t *testing.T) {
	rest, options := FixOptionsArguments([]string{"-p", "tsconfig.json", "--fix-migration-only", "--noEmit"})
	if !options.MigrationOnly || !reflect.DeepEqual(rest, []string{"-p", "tsconfig.json", "--noEmit"}) {
		t.Fatalf("scope parse: %v %+v", rest, options)
	}
	_, config := fixFiles(t)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, options)
	if len(result.Files) != 0 || len(result.Refused) != 0 {
		t.Fatalf("S0 migration-only fix changed existing style sites: %+v", result)
	}
}

func TestLegacySitesObserveCheckedDecisions(t *testing.T) {
	for _, test := range []struct {
		kind         LegacyKind
		source, text string
	}{
		{LegacyByNameArgument, `function work(): number!! { sleep(1); return 1 }; export function use() { return retry(work(), Schedule.recurs(1)) }`, "work()"},
		{LegacyByNameElement, `function work(): number!! { sleep(1); return 1 }; export function use() { return all([work()]) }`, "work()"},
		{LegacyByNameField, `declare function accept(x: { value: number!! }): number; export function use() { return accept({ value: (sleep(1), 1) }) }`, "sleep(1), 1"},
		{LegacyByNameDo, `declare const o: { accept(x: number!!): number } | undefined; export function use() { return o?.accept(do { sleep(1); 1 }) }`, "do { sleep(1); 1 }"},
		{LegacyByNameTopic, `function work(): number!! { sleep(1); return 1 }; export function use() { return work() |> retry(%, Schedule.recurs(1)) }`, "%"},
		{LegacyHeldConst, `function work(): number!! { return 1 }; export const held: number!! = work()`, "work()"},
		{LegacyHeldField, `function work(): number!! { return 1 }; export const held: { value: number!! } = { value: work() }`, "work()"},
		{LegacyFactory, `export function uncalled(): number!! { const snapshot = 1; return () => snapshot }`, "export function uncalled(): number!! { const snapshot = 1; return () => snapshot }"},
		{LegacyPipeLookAhead, `export function use() { return pipe(() => { sleep(1); return 1 }, Effect.retry({ times: 1 })) }`, "() => { sleep(1); return 1 }"},
		{LegacyDualBlock, `export function use() { return withSpan("test") { sleep(1); return 1 } }`, "withSpan(\"test\") { sleep(1); return 1 }"},
		{LegacyAwaitElement, `export function use() { const held: number!! = Effect.succeed(1); return await.all [held] }`, "held"},
		{LegacyForkOperand, `export function use() { const held: number!! = Effect.succeed(1); const f = fork held; return join f }`, "held"},
		{LegacyOverloadRank, `declare function choose(x: number): number; declare function choose(x: number!!): number; function work(): number!! { sleep(1); return 1 }; export function use() { return choose(work()) }`, "choose(work())"},
		{LegacyOverloadForm, `declare function choose(x: number!!): number; declare function choose(x: () => number): number; export function use() { return choose(() => 1) }`, "() => 1"},
	} {
		t.Run(string(test.kind), func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.source)
			before := p.GetSemanticDiagnostics(t.Context(), file)
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			sites := LegacySites(c, file)
			found := false
			for _, site := range sites {
				if test.kind == LegacyDualBlock && site.Kind == LegacyOverloadForm {
					t.Fatal("a syntax-built block was counted as a function literal")
				}
				if site.Kind != test.kind {
					continue
				}
				found = true
				if got := file.Text()[site.Span.Pos():site.Span.End()]; got != test.text {
					t.Errorf("span %q; want %q", got, test.text)
				}
				if site.Boundary == "" || site.Representation == "" || site.Signature == nil {
					t.Errorf("incomplete site: %+v", site)
				}
				if test.kind == LegacyFactory && len(site.ReturnedPrograms) != 1 {
					t.Error("uncalled factory's returned program was not recorded")
				}
			}
			if !found {
				t.Fatalf("missing %s in %+v", test.kind, sites)
			}
			if again := LegacySites(c, file); !reflect.DeepEqual(sites, again) {
				t.Fatal("analysis is not stable on a checked program")
			}
			after := c.GetDiagnostics(t.Context(), file)
			if len(before) != len(after) {
				t.Fatal("analysis changed diagnostics")
			}
			for i := range before {
				if before[i].String() != after[i].String() {
					t.Fatal("analysis changed a diagnostic")
				}
			}
		})
	}
}

// S3: a keyword operand whose meaning syntax keeps, such as a call D147
// passed by name, is a syntax-owned region now: neither a by-name decision
// nor an awaitElement or forkOperand site.
func TestLegacySitesSkipKeywordOperandsThatKeepTheirMeaning(t *testing.T) {
	source := `function work(): number!! { sleep(1); return 1 }; export function use() { const f = fork work(); return [join f, await.all [work(), do { work() }], await.all { a: work() }] }`
	p, file, _, _ := editorProgram(t, source)
	p.GetSemanticDiagnostics(t.Context(), file)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	if sites := LegacySites(c, file); len(sites) != 0 {
		t.Fatalf("recorded syntax-owned keyword operands: %+v", sites)
	}
}

func TestLegacySitesExcludePlainTypeScriptHatches(t *testing.T) {
	source := `export function use() { return sync(() => { const held: Effect.Effect<number> = Effect.succeed(1); return held }) }`
	p, file, _, _ := editorProgram(t, source)
	p.GetSemanticDiagnostics(t.Context(), file)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	for _, site := range LegacySites(c, file) {
		if strings.Contains(file.Text()[site.Span.Pos():site.Span.End()], "Effect.succeed") {
			t.Fatalf("recorded plain TypeScript as VibeLang: %+v", site)
		}
	}
}

func TestLegacySitesKeepRejectedCandidateEvidence(t *testing.T) {
	source := `declare function choose(value: number!!, tag: "no"): number; declare function choose(value: number, tag: "yes"): number; function work(): number!! { sleep(1); return 1 }; export function use() { return choose(work(), "yes") }`
	p, file, _, _ := editorProgram(t, source)
	p.GetSemanticDiagnostics(t.Context(), file)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	for _, site := range LegacySites(c, file) {
		if site.Kind == LegacyByNameArgument && file.Text()[site.Span.Pos():site.Span.End()] == "work()" && !site.Selected && len(site.Candidates) > 0 {
			return
		}
	}
	t.Fatal("lost the by-name form of an overload that rejected another argument")
}

func TestLegacySitesRecordNeverRankingRejection(t *testing.T) {
	source := `declare function choose(value: never): number; declare function choose(value: number): number; function stop(): never!Error { throw new Error("stop") }; export function use() { return choose(stop()) }`
	p, file, _, _ := editorProgram(t, source)
	p.GetSemanticDiagnostics(t.Context(), file)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	for _, site := range LegacySites(c, file) {
		if site.Kind == LegacyOverloadRank && site.Uncertainty == "no applicable signature" {
			return
		}
	}
	t.Fatal("lost D257's rejection of never at a value overload")
}
