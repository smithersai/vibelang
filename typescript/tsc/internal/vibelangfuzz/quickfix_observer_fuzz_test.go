package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// Keys survive corpus reordering. A mutation chooses a census case for its
// code and adds trivia; focused native witnesses also vary values, throws,
// promises and generator completion at the JavaScript caller boundary.
func FuzzQuickFixBehavior(f *testing.F) {
	startShortBudget(f)
	generators := quickfixBehaviorSeeds()
	for _, code := range ls.CodeFixCodes("EK") {
		if len(generators[code]) == 0 {
			f.Fatalf("EK%04d has no generator", code)
		}
		if !testing.Short() || toolsFuzzing() || os.Getenv("VIBELANG_FUZZ_SEEDS") == "all" {
			// Replay CRLF and an astral comment before every registered fix site.
			f.Add(fmt.Sprintf("EK%04d@%s", code, generators[code][0].Name), []byte{3, 1})
			corpus := filepath.Join(repoTestdata(), "fuzz", quickfixBehaviorTarget, fmt.Sprintf("registry-EK%04d", code))
			if _, err := os.Stat(corpus); os.IsNotExist(err) {
				f.Add(fmt.Sprintf("EK%04d@%s", code, generators[code][0].Name), []byte{0})
			}
		}
	}
	for _, key := range []string{"ordinary-promise", "ordinary-throw", "schema-alias-canonical", "effect-alias-forwarding"} {
		f.Add(key, []byte{7, 1})
	}
	w := NewWorkspace(f)
	binary := cliBuild(f, f.TempDir())
	api := declarationIdentityAPI(f)
	requireQuickfixTS593(f, api)
	f.Fuzz(func(t *testing.T, key string, choices []byte) {
		if testing.Short() && !toolsFuzzing() && os.Getenv("VIBELANG_FUZZ_SEEDS") != "all" && key != "opencode-generator-return" {
			t.Skip("full behavior corpus replay: set VIBELANG_FUZZ_SEEDS=all; this skip is not a pass")
		}
		toolsGuard(t, quickfixBehaviorTarget, func() {
			TestQuickFixBehaviorQuoted(t)
			t.Logf("generator key=%s choices=%v", key, choices)
			files, code, native := quickfixBehaviorProgram(generators, key, choices)
			if files == nil {
				if strings.HasPrefix(corpusFile(t, quickfixBehaviorTarget), "registry-EK") {
					t.Fatalf("saved registry seed has no generator: %s", key)
				}
				return
			}
			checkKey, _, _ := strings.Cut(key, "@")
			quickfixBehaviorCheck(t, w, binary, api, checkKey, code, native, files)
			if t.Failed() {
				t.FailNow()
			}
		})
	})
}

func requireQuickfixTS593(tb testing.TB, api string) {
	tb.Helper()
	data, err := os.ReadFile(filepath.Join(api, "package.json"))
	if err != nil || !strings.Contains(string(data), `"version": "5.9.3"`) {
		tb.Fatalf("quick-fix API oracle requires stock TypeScript 5.9.3: %v", err)
	}
}

func quickfixBehaviorProgram(generators map[int32][]Seed, key string, choices []byte) (map[string]string, int32, bool) {
	n, variant := 7, 0
	if len(choices) > 0 {
		n = int(choices[0])
	}
	if len(choices) > 1 {
		variant = int(choices[1])
	}
	var source string
	switch key {
	case "opencode-generator-return":
		// A foreign .ts caller observes done AND value, including the final
		// return. No Effect-only export selector can observe this boundary.
		source = fmt.Sprintf("export function* subject() { yield %d; return %d }\nexport function main() { const g = subject(); return [g.next(), g.next(), g.next()] }\n", n, n+1)
	case "opencode-refused-file":
		source = fmt.Sprintf("import * as Effect from \"effect/Effect\"\nexport const refused = Effect.fn(\"refused\")(function* <A>(value: A): Effect.fn.Return<A> { return yield* Effect.succeed(value) })\nexport function main() { return refused(%d) }\n", n)
	case "opencode-mixed-generators":
		source = fmt.Sprintf("import * as Effect from \"effect/Effect\"\nexport const applied = () => Effect.gen(function* () { return yield* Effect.succeed(%d) })\nexport const refused = Effect.fn(\"refused\")(function* <A>(value: A): Effect.fn.Return<A> { return yield* Effect.succeed(value) })\nexport function main() { return Effect.all([applied(), refused(%d)]) }\n", n, n+1)
	case "mixed-refused-file", "only-refused-file":
		source = fmt.Sprintf("import * as Option from \"effect/Option\"\nexport const refused = (v: Option.Option<number>): number => /* quickfix:refused:start */ Option.match(v,\n /* keep the argument comment %d */\n { onNone: () => %d, onSome: (value): number => value }) /* quickfix:refused:end */\nexport function main() { return refused(Option.some(%d)) }\n", n, n, n+1)
		if key == "mixed-refused-file" {
			source = "import type * as E from \"effect/Effect\"\nexport type Applied = E.Effect<number>\n" + source
			return map[string]string{"main.vibe": source}, 4833, false
		}
		return map[string]string{"main.vibe": source}, 4839, false
	case "schema-alias-api", "schema-alias-canonical":
		helper := "export namespace Schema { export type Type<T> = \"sentinel\" }\n"
		if n&1 != 0 {
			helper = "export namespace Schema { export type Type<T> = { readonly brand: \"custom\" } }\n"
		}
		use := "import type * as Schema from \"./custom.js\"\n"
		if key == "schema-alias-canonical" {
			use = ""
		}
		ownType := "export type User = Schema.Schema.Type<typeof User>\n"
		if key == "schema-alias-api" && variant&1 != 0 && n&1 != 0 {
			ownType = "export interface User extends Schema.Schema.Type<typeof User> {}\n"
		}
		if key == "schema-alias-canonical" {
			ownType = "export type User = typeof User.Type\n"
		}
		source = "import { Schema as S } from \"effect\"\n" + use + "export const User = S.Struct({})\n" + ownType + "export function main() { return User.make({}) }\n"
		// RC-45 appears with declaration emission disabled during the repair.
		// Inspection emits declarations independently, after fixing, just as a
		// native caller can consume the repaired public API later.
		return map[string]string{"custom.ts": helper, "main.vibe": source, "tsconfig.json": strings.Replace(DefaultConfig, "\"declaration\": true", "\"declaration\": false", 1)}, 4832, true
	case "effect-alias-api", "effect-alias-forwarding":
		body := "Base.Effect<E,A,R>"
		if key == "effect-alias-forwarding" {
			body = "Base.Effect<A,E,R>"
		}
		helper := "import type { Effect as Base } from \"effect\"\nexport type Effect<A,E=never,R=never> = " + body + "\n"
		arguments := "number,string"
		if variant&2 != 0 {
			arguments = "number"
		}
		source = fmt.Sprintf("import type * as Custom from \"./custom.js\"\nexport type Result = Custom.Effect<%s>\nexport function main() { return %d }\n", arguments, n)
		return map[string]string{"custom.ts": helper, "main.vibe": source}, 4833, true
	case "cause-written-result":
		source = fmt.Sprintf("export effect function main(): number!! { try { return %d } catch (cause: Cause) { return %d } }\n", n, n+1)
		return map[string]string{"main.vibe": source}, 2113, false
	case "ordinary-promise":
		source = fmt.Sprintf("export async function main() { return %d }\n", n)
	case "ordinary-throw":
		source = fmt.Sprintf("export function main() { throw { marker: %d } }\n", n)
	default:
		codeKey, caseName, _ := strings.Cut(key, "@")
		var code int32
		if _, err := fmt.Sscanf(codeKey, "EK%d", &code); err != nil || fmt.Sprintf("EK%04d", code) != codeKey {
			return nil, 0, false
		}
		seeds := generators[code]
		if len(seeds) == 0 {
			return nil, 0, false
		}
		selected := seeds[variant%len(seeds)]
		if caseName != "" {
			found := false
			for _, seed := range seeds {
				if seed.Name == caseName {
					selected = seed
					found = true
					break
				}
			}
			if !found {
				return nil, 0, false
			}
		}
		files := maps.Clone(selected.Files)
		main := toolsMainFile(files)
		if code == 2113 && selected.Name == "EK2113" {
			pairs := [][2]string{
				{strconv.Itoa(n), strconv.Itoa(n + 1)},
				{strconv.Quote("left" + strconv.Itoa(n)), strconv.Quote("right" + strconv.Itoa(n))},
				{strconv.Itoa(n) + "n", strconv.Itoa(n+1) + "n"},
				{"-" + strconv.Itoa(n+1), "-" + strconv.Itoa(n+2)},
			}
			pair := pairs[variant%len(pairs)]
			files[main] = fmt.Sprintf("export effect function main() { try { return %s } catch (cause: Cause) { return %s } }\n", pair[0], pair[1])
		}
		sentinel := "// quick-fix preservation sentinel " + strconv.Itoa(n) + "\n"
		if n&1 != 0 {
			sentinel = "/* quick-fix preservation sentinel " + strconv.Itoa(n) + " 🧪 */ "
		}
		// File diagnostic directives must begin their own line. Put the
		// astral comment before the first code line, after leading // comments.
		at := 0
		for _, line := range strings.SplitAfter(files[main], "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "//") {
				break
			}
			at += len(line)
		}
		files[main] = files[main][:at] + sentinel + files[main][at:]
		if n&1 != 0 {
			// A trailing JSDoc exercises comment preservation without attaching
			// to a declaration or moving file diagnostic directives past a token.
			files[main] += "\n/** quick-fix preservation tail " + strconv.Itoa(n) + " 🧪 */\n"
		}
		if n&2 != 0 {
			for name, text := range files {
				if isSource(name) {
					files[name] = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
				}
			}
		}
		return files, code, false
	}
	code := int32(2128)
	switch key {
	case "opencode-refused-file", "opencode-mixed-generators":
		code = 1002
	case "schema-alias-api":
		code = 4832
	case "effect-alias-api":
		code = 4833
	}
	return map[string]string{"main.vibe": "/* quick-fix preservation sentinel 🧪 */ " + source}, code, true
}

type quickfixFileState struct {
	text     string
	modified time.Time
}

func quickfixSnapshot(t *testing.T, dir string, files map[string]string) map[string]quickfixFileState {
	t.Helper()
	state := map[string]quickfixFileState{}
	for name := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		text, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		state[name] = quickfixFileState{string(text), info.ModTime()}
	}
	return state
}

func quickfixBehaviorCheck(t *testing.T, w *Workspace, binary, api, key string, code int32, native bool, files map[string]string) {
	t.Helper()
	files = maps.Clone(files)
	if _, ok := files["package.json"]; !ok {
		// Fresh harness directories must represent the same package for derived
		// service identities, as well as for Node's module interpretation.
		files["package.json"] = `{"type":"module","name":"quickfix-fixture"}`
	}
	pending := false
	defer func() {
		if pending && !t.Failed() {
			t.Skip("one or more preservation oracles are pending; this input is not a pass")
		}
	}()
	before := toolsCompile(t, w, quickfixBehaviorTarget, files)
	defer before.Remove()
	if before.Program == nil {
		t.Fatal("generator produced no program")
	}
	found := false
	for _, d := range before.Diagnostics {
		if IsEK(d) && d.Code() == code {
			found = true
		}
	}
	referenceKind := "source"
	baseline := toolsCompile(t, w, quickfixBehaviorTarget, quickfixAnalysisFiles(files))
	defer baseline.Remove()
	if reference := quickfixGoldenReference(key, files); reference != nil {
		referenceKind = "golden"
		baseline = toolsCompile(t, w, quickfixBehaviorTarget, quickfixAnalysisFiles(reference))
		defer baseline.Remove()
	}
	if native {
		referenceKind = "typescript"
		twin := maps.Clone(files)
		for name, text := range maps.Clone(twin) {
			if strings.HasSuffix(name, ".vibe") {
				twin[strings.TrimSuffix(name, ".vibe")+".ts"] = text
				delete(twin, name)
			}
		}
		baseline = toolsCompile(t, w, quickfixBehaviorTarget, quickfixAnalysisFiles(twin))
		defer baseline.Remove()
	}
	files = quickfixProjectFiles(t, before.Dir, files)
	codes := []int32{code}
	if key == "mixed-refused-file" {
		codes = append(codes, 4839)
	}
	plans, editorRefused, editorSeen := quickfixEditorPlans(t, w, before, files, codes)
	if !native && !found && !editorSeen[code] {
		Gap(t, quickfixBehaviorTarget, key+":trigger", "registered fix has no CLI or editor diagnostic on its keyed generator:\n%s\n%v", Archive(files), SortedKeys(Keys(before.Dir, before.Diagnostics)))
	}
	// A deliberately old, non-rounded timestamp detects writes even on a fast
	// filesystem, without depending on a wall-clock sleep.
	for name := range files {
		path := filepath.Join(before.Dir, filepath.FromSlash(name))
		stamp := time.Unix(123456789, 0)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := quickfixSnapshot(t, before.Dir, files)
	args := []string{"-p", "tsconfig.json", "--fix", "--noEmit", "--pretty", "false"}
	run := cliExec(binary, before.Dir, args, "", Project{})
	if run.Hung != "" || cliCrashed(run) {
		t.Fatalf("CLI failed: %+v", run)
	}
	fixed := maps.Clone(files)
	afterFiles := quickfixProjectFiles(t, before.Dir, files)
	afterState := quickfixSnapshot(t, before.Dir, afterFiles)
	changed := false
	for name, state := range afterState {
		fixed[name] = state.text
		changed = changed || state.text != snapshot[name].text
	}
	output := run.Stdout + "\n" + run.Stderr
	refused := strings.Contains(output, "not fixed:") || strings.Contains(strings.ToLower(output), "refus")
	// Until refusal ranges land, generators mark their exact refused declaration.
	// Comparing these unique spans permits unrelated edits before and after them.
	for name, text := range files {
		if span, ok := quickfixMarkedRefusal(text); ok && (refused || strings.Contains(text, "/* quickfix:refused:start */")) {
			lines := newToolsLines(text)
			start, end := lines.position(span.start), lines.position(span.end)
			refusedCode := code
			if key == "mixed-refused-file" {
				refusedCode = 4839
			}
			t.Logf("refused-site %s:%d:%d-%d:%d EK%04d (generator-owned original span)", name, start.Line+1, start.Character+1, end.Line+1, end.Character+1, refusedCode)
			if !strings.Contains(afterState[name].text, text[span.start:span.end]) {
				Gap(t, quickfixBehaviorTarget, key+":refused-span", "refused span %s:%d-%d changed\nbefore:\n%s\nafter:\n%s", name, span.start, span.end, text, afterState[name].text)
			}
		}
	}
	for name, state := range afterState {
		if state.text == snapshot[name].text {
			if !state.modified.Equal(snapshot[name].modified) {
				Gap(t, quickfixBehaviorTarget, key+":noop-mtime", "unchanged file %s was rewritten", name)
			}
		}
	}
	if changed {
		if !quickfixSubcheck(t, "cli", func(t *testing.T) { quickfixCompare(t, w, api, key+":cli", baseline, before, fixed) }) {
			pending = true
		}
	}
	second := cliExec(binary, before.Dir, args, "", Project{})
	stableFiles := quickfixProjectFiles(t, before.Dir, afterFiles)
	stable := quickfixSnapshot(t, before.Dir, stableFiles)
	if second.Hung != "" || cliCrashed(second) {
		t.Fatalf("second CLI run failed: %+v", second)
	}
	for name, state := range stable {
		if state.text != afterState[name].text || !state.modified.Equal(afterState[name].modified) {
			Gap(t, quickfixBehaviorTarget, key+":fixed-point", "second --fix changed %s (bytes or mtime)", name)
		}
	}

	// Every plan was requested from the original source before the CLI ran.
	// Apply each independently; a refused diagnostic's range is protected
	// against edits offered for any other site in this snapshot.
	for i, plan := range plans {
		edited := maps.Clone(files)
		for name, changes := range plan.edits {
			text := edited[name] // an action may create a foreign .ts boundary
			updated, spans, err := toolsApply(text, changes)
			if err != nil {
				t.Fatal(err)
			}
			for _, site := range editorRefused {
				if site.file == name {
					if problem := quickfixRefusedEdit(text, updated, site.span, spans); problem != "" {
						Gap(t, quickfixBehaviorTarget, key+":editor-refused-span", "%s EK%04d: %s", name, site.code, problem)
					}
				}
			}
			if site, ok := quickfixMarkedRefusal(text); ok {
				atSite := name == plan.file && plan.start >= site.start && plan.start < site.end
				if !atSite {
					if problem := quickfixRefusedEdit(text, updated, site, spans); problem != "" {
						Gap(t, quickfixBehaviorTarget, key+":editor-refused-span", "%s: %s", name, problem)
					}
				}
			}
			edited[name] = updated
		}
		if !quickfixSubcheck(t, fmt.Sprintf("editor-%d", i+1), func(t *testing.T) {
			quickfixCompare(t, w, api, key+":editor", baseline, before, edited)
		}) {
			pending = true
		}
	}
	actions := len(plans)

	t.Logf("coverage %s code=EK%04d cli_changed=%t refused=%t editor_actions=%d baseline_errors=%t reference=%s", key, code, changed, refused, actions, !toolsErrorFree(baseline), referenceKind)
}

func quickfixCompare(t *testing.T, w *Workspace, api, key string, before, original *Result, files map[string]string) {
	t.Helper()
	for name, source := range original.Sources {
		if text, ok := files[name]; ok {
			if lost := toolsLostComments(source, text); len(lost) != 0 {
				Gap(t, quickfixBehaviorTarget, key+":comments", "lost comments %q", lost)
			}
		}
	}
	after := toolsCompile(t, w, quickfixBehaviorTarget, quickfixAnalysisFiles(files))
	defer after.Remove()
	if !toolsErrorFree(before) {
		// An error recovery emit is not an executable baseline. This is coverage
		// debt, never a successful behavioral comparison.
		Gap(t, quickfixBehaviorTarget, key+":baseline", "generator needs a runnable native twin; baseline diagnostics: %v", SortedKeys(Keys(before.Dir, before.Diagnostics)))
	}
	if added := toolsAddedErrors(original, after); len(added) != 0 {
		Gap(t, quickfixBehaviorTarget, key+":errors", "repair adds errors: %v\n%s", added, Archive(files))
	}
	if after.EmitSkipped {
		Gap(t, quickfixBehaviorTarget, key+":after", "repair does not produce a runnable program")
	}
	apiComplete := quickfixSubcheck(t, "api", func(t *testing.T) { quickfixStockContracts(t, w, api, key, before, after) })
	runtimeComplete := quickfixSubcheck(t, "runtime", func(t *testing.T) {
		entries := toolsRunnableExports(before)
		// Also observe ordinary main functions; the existing export selector
		// deliberately admits only Effects.
		entries = append(entries, quickfixOrdinaryExports(before)...)
		slices.SortFunc(entries, func(a, b toolsRunnable) int { return strings.Compare(a.file+":"+a.name, b.file+":"+b.name) })
		entries = slices.Compact(entries)
		observed := 0
		for _, entry := range entries {
			// A JS adapter awaits Promises, consumes generator.next() including the
			// completion record, captures thrown values and reads traceOf after work.
			was := quickfixCaller(t, w, before, entry)
			is := quickfixCaller(t, w, after, entry)
			if toolsInvalidOutcome(was) {
				Gap(t, quickfixBehaviorTarget, key+":baseline-runtime", "generator's baseline cannot be observed: %+v", was)
			}
			if toolsInvalidOutcome(is) {
				Gap(t, quickfixBehaviorTarget, key+":outcome", "repair makes the caller unobservable: before=%+v after=%+v", was, is)
			}
			if !toolsSameOutcome(was, is) {
				Gap(t, quickfixBehaviorTarget, key+":outcome", "observable caller outcome changed: before=%+v after=%+v\n%s", was, is, Archive(files))
			}
			observed++
		}
		if observed == 0 {
			Gap(t, quickfixBehaviorTarget, key+":observer", "no callable runtime observer; declaration checks alone do not prove behavior")
		}
	})
	if (!apiComplete || !runtimeComplete) && !t.Failed() {
		t.Skip("API or runtime oracle is pending")
	}
}

// Keep the existing Node worker and its single Exit comparator. The adapter
// turns ordinary JS observations into an Effect value for that worker.
func quickfixCaller(t *testing.T, w *Workspace, r *Result, entry toolsRunnable) Outcome {
	t.Helper()
	module := filepath.Join(r.Dir, filepath.FromSlash(entry.file))
	probe := `import * as subject from ` + strconv.Quote("./"+filepath.Base(module)) + `;
import { Effect, Exit, Cause } from "effect";
const capture = (v) => v === undefined ? {$undefined:true} : v instanceof Error ? {name:v.name,message:v.message,...Object.fromEntries(Object.getOwnPropertyNames(v).filter(k=>k!=="stack").map(k=>[k,capture(v[k])]))} : v;
async function ordinary(v) {
 const results = [];
 try {
  v = await v;
  if (v && typeof v.next === "function") {
   for (let i=0;i<32;i++) { const step = await v.next(); results.push({done:step.done,value:capture(step.value)}); if(step.done) return {steps:results}; }
   return {observerBound:true};
  }
  return {returned:capture(v)};
 } catch (e) { return {thrown:capture(e),steps:results}; }
}
export function main() {
 let value;
 const beforeCall = subject.traceOf?.()?.slice?.();
 try {
  if(!Object.hasOwn(subject,` + strconv.Quote(entry.name) + `)) throw new Error("missing observable export");
  const candidate=subject[` + strconv.Quote(entry.name) + `];
  value=typeof candidate==="function" ? candidate() : candidate;
 } catch(e) { return Effect.succeed({thrown:capture(e),trace:subject.traceOf?.()}); }
 const afterCall = subject.traceOf?.()?.slice?.();
 const finish = (value) => ({value,beforeCall,afterCall,trace:subject.traceOf?.()});
 if(Effect.isEffect(value)) return Effect.map(Effect.exit(value), exit=>finish({effectExit:
  Exit.isSuccess(exit) ? {kind:"success",value:capture(exit.value)} :
  {kind:"failure",reasons:exit.cause.reasons.map(reason=>
   Cause.isFailReason(reason) ? {kind:"fail",value:capture(reason.error)} :
   Cause.isDieReason(reason) ? {kind:"die",value:capture(reason.defect)} :
   {kind:"interrupt"})}
 }));
 return Effect.map(Effect.promise(()=>ordinary(value)),finish);
}
`
	path := filepath.Join(filepath.Dir(module), "__quickfix_probe.js")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(probe), 0o600); err != nil {
		t.Fatal(err)
	}
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	outcome := node.Run(r, strings.TrimPrefix(filepath.ToSlash(path), filepath.ToSlash(r.Dir)+"/"), "main")
	var observation struct{ Value struct{ ObserverBound bool } }
	if err := json.Unmarshal(outcome.Value, &observation); err == nil && observation.Value.ObserverBound {
		t.Fatal("generator observation exceeded its finite 32-step bound; shorten the generator")
	}
	return outcome
}

func quickfixStockContracts(t *testing.T, w *Workspace, api, key string, before, after *Result) {
	t.Helper()
	dir := filepath.Join(w.Dir, "api-"+strconv.FormatInt(w.next.Add(1), 10))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	modules := []string{}
	for name, original := range before.Outputs {
		if !strings.HasSuffix(name, ".d.ts") {
			continue
		}
		fixed, ok := after.Outputs[name]
		if !ok {
			Gap(t, quickfixBehaviorTarget, key+":api", "declaration %s disappeared", name)
		}
		// Fresh harness directories are not a source-level change to a derived
		// service key. Use the same directory normalization as toolsContractMismatch.
		original = strings.ReplaceAll(original, "\""+filepath.Base(before.Dir)+"/", "\"project/")
		fixed = strings.ReplaceAll(fixed, "\""+filepath.Base(after.Dir)+"/", "\"project/")
		if lost := toolsLostComments(original, fixed); len(lost) != 0 {
			Gap(t, quickfixBehaviorTarget, key+":declaration-comments", "declaration %s lost comments %q", name, lost)
		}
		name = strings.TrimPrefix(name, "out/")
		for side, text := range map[string]string{"a": original, "b": fixed} {
			// Duplicate nominal members identify the same source class; the existing
			// contract oracle likewise strips only the synthetic private marker.
			if err := writeInside(dir, side+"/"+name, nominalMember.ReplaceAllString(text, "")); err != nil {
				t.Fatal(err)
			}
		}
		modules = append(modules, strings.TrimSuffix(name, ".d.ts"))
	}
	if len(modules) == 0 {
		t.Fatal("no declaration output to compare")
	}
	slices.Sort(modules)
	output, err := quickfixTS593Contracts(t, api, dir, modules)
	if err != nil {
		Gap(t, quickfixBehaviorTarget, key+":api", "stock tsc 5.9.3 rejects bidirectional API assignments: %v\n%s", err, output)
	}
}

func quickfixTS593Contracts(t testing.TB, api, dir string, modules []string) (string, error) {
	t.Helper()
	request := filepath.Join(dir, "check.cjs")
	script := `const ts = require(` + strconv.Quote(filepath.Join(api, "lib/typescript.js")) + `);
const fs=require("node:fs"), path=require("node:path");
const modules=` + quickfixJSON(modules) + `;
let text="";
for(let n=0;n<modules.length;n++) {
 const m=modules[n];
 text += "import * as A"+n+" from './a/"+m+".js';\nimport * as B"+n+" from './b/"+m+".js';\n";
 text += "export const ab"+n+": typeof A"+n+" = B"+n+";\nexport const ba"+n+": typeof B"+n+" = A"+n+";\n";
 const parse=side=>ts.createSourceFile(m,fs.readFileSync(path.join(__dirname,side,m+".d.ts"),"utf8"),ts.ScriptTarget.Latest,true);
 const ast=parse("a"), other=parse("b");
 const exportedTypes=ast=>ast.statements.filter(s=>(ts.isTypeAliasDeclaration(s)||ts.isInterfaceDeclaration(s))&&s.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword)).map(s=>s.name.text).sort();
 if(JSON.stringify(exportedTypes(ast))!==JSON.stringify(exportedTypes(other))) throw new Error("exported type names changed in "+m);
 let prefix="__quickfix_type_";
 while(fs.readFileSync(path.join(__dirname,"a",m+".d.ts"),"utf8").includes(prefix)||fs.readFileSync(path.join(__dirname,"b",m+".d.ts"),"utf8").includes(prefix)) prefix+="_";
 for(const [side,tree] of [["a",ast],["b",other]]) {
  let probes="";
  for(const s of tree.statements) {
   if(!(ts.isTypeAliasDeclaration(s)||ts.isInterfaceDeclaration(s))||!s.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword)) continue;
   const name=s.modifiers.some(x=>x.kind===ts.SyntaxKind.DefaultKeyword)?"default":s.name.text;
   const ps=s.typeParameters??[],args=ps.length?"<"+ps.map(p=>p.name.text).join(",")+">":"";
   const params=ps.length?"<"+ps.map(p=>p.name.getText(tree)+(p.constraint?" extends "+p.constraint.getText(tree):"")+(p.default?" = "+p.default.getText(tree):"")).join(",")+">":"";
   // Keep constraints in their original module scope and quantify over them.
   // A self-import avoids shadowing an alias such as type T<T> = T[].
   probes+="export declare function "+prefix+name+params+"(): import("+JSON.stringify("./"+path.basename(m)+".js")+")."+name+args+";\n";
  }
  fs.appendFileSync(path.join(__dirname,side,m+".d.ts"),"\n"+probes);
 }

}
fs.writeFileSync(path.join(__dirname,"check.ts"),text);
const program=ts.createProgram([path.join(__dirname,"check.ts")],{strict:true,noEmit:true,skipLibCheck:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2022,types:[]});
const errors=ts.getPreEmitDiagnostics(program);
if(errors.length){process.stdout.write(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>__dirname,getNewLine:()=>"\n"}));process.exitCode=1;}
`
	if err := os.WriteFile(request, []byte(script), 0o600); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", request)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func quickfixJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

// A skipped leaf remains explicit coverage debt. Run siblings first so an API
// gap cannot hide a changed runtime result, then propagate its incomplete state.
func quickfixSubcheck(t *testing.T, name string, body func(*testing.T)) bool {
	complete := false
	t.Run(name, func(t *testing.T) { body(t); complete = true })
	return complete
}

// A repair in a project without declaration emit must still preserve the API
// when that project later emits declarations. Never rerun the repair with this
// inspection configuration: it would activate different preservation guards.
func quickfixAnalysisFiles(files map[string]string) map[string]string {
	result := maps.Clone(files)
	if config, ok := result["tsconfig.json"]; ok {
		var object map[string]any
		if err := json.Unmarshal([]byte(config), &object); err != nil {
			return result
		}
		options, _ := object["compilerOptions"].(map[string]any)
		if options == nil {
			options = map[string]any{}
			object["compilerOptions"] = options
		}
		options["declaration"] = true
		options["noEmit"] = false
		options["emitDeclarationOnly"] = false
		options["noEmitOnError"] = false
		options["outDir"] = "out"
		options["rootDir"] = "."
		result["tsconfig.json"] = quickfixJSON(object)
	}
	return result
}

// The CLI may create a foreign TypeScript boundary. Include that source in the
// after program and fixed-point snapshot, rather than compiling a partial view.
func quickfixProjectFiles(t *testing.T, dir string, original map[string]string) map[string]string {
	t.Helper()
	files := maps.Clone(original)
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path != dir && (entry.Name() == "out" || entry.Name() == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if strings.HasSuffix(rel, ".d.vibe.ts") {
			return nil
		}
		if isSource(rel) || strings.HasSuffix(rel, ".json") {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files[rel] = string(data)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}
