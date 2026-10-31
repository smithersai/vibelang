package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
)

// FuzzDeclarationIdentity enforces docs/design/src/000-intro.md:
// "VibeLang is TypeScript with a small set of constructs for writing Effect programs"
// and principle 4, "TypeScript's meaning outside Effect code"; and Chapter 1,
// docs/design/src/001-functions.md, Declaration output:
// "Declarations are exactly what idiomatic Effect TypeScript would declare."
// Renaming ordinary .ts sources to .vibe, without editing their text (in
// particular their ./x.js imports, D298), must preserve stock TypeScript's
// declarations under the migration identity gate's canonicalize equivalence.
func FuzzDeclarationIdentity(f *testing.F) {
	startShortBudget(f)
	tsc := StockTypeScript(f)
	api := declarationIdentityAPI(f)
	w := NewWorkspace(f)
	for _, seed := range ParitySeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, archive string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		CheckDeclarationIdentity(t, w, tsc, api, archive)
	})
}

// declarationIdentityAPI is the JS API used by the migration gate, distinct
// from the stock TypeScript 7 executable (which has no JS compiler API).
func declarationIdentityAPI(tb testing.TB) string {
	tb.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = filepath.Join(Root(), "experiments/node_modules")
	}
	api := filepath.Join(modules, "typescript")
	if _, err := os.Stat(filepath.Join(api, "lib/typescript.js")); err != nil {
		Missing(tb, "declaration identity needs the TypeScript JS API at %s: install experiments' pinned TypeScript or set EFFECT_NODE_MODULES", api)
	}
	return api
}

// Configuration file lists and globs follow the rename; source text never
// does. Declaration inputs stay TypeScript. This also keeps JSONC configs,
// including comments and trailing commas, readable by the real config parser.
var declarationIdentityTSPath = regexp.MustCompile(`"[^"\n]*\.ts"`)

func declarationIdentityProjects(archive string) (Project, Project, string) {
	stock := ProjectFromArchive(archive)
	if len(Unarchive(archive)) == 0 {
		stock = Project{Files: map[string]string{"main.ts": archive}}
	}
	if reason := Admissible(stock); reason != "" {
		return Project{}, Project{}, reason
	}
	const inputConfig = "__declaration_identity.json"
	if _, exists := stock.Files[inputConfig]; exists {
		return Project{}, Project{}, "reserved identity configuration name"
	}
	vibe := Project{Files: map[string]string{}}
	configs := declarationIdentityConfigs(stock)
	sources := 0
	for name, text := range stock.Files {
		if !isTypeScript(name) && !strings.HasSuffix(name, ".json") {
			return Project{}, Project{}, "not a TypeScript project"
		}
		if isTypeScript(name) && !isDeclaration(name) {
			if !strings.HasSuffix(name, ".ts") {
				return Project{}, Project{}, "only .ts sources can be renamed to .vibe"
			}
			name = strings.TrimSuffix(name, ".ts") + ".vibe"
			sources++
		} else if configs[name] {
			text = declarationIdentityConfig(text)
		}
		vibe.Files[name] = text
	}
	if sources == 0 {
		return Project{}, Project{}, "no .ts sources"
	}
	config := stock.Config
	if config == "" {
		config = DefaultConfig
	}
	stock.Files[inputConfig] = config
	vibe.Files[inputConfig] = declarationIdentityConfig(config)
	// Both sides get the same declaration-only emit request. An extends
	// wrapper overrides noEmit in cases without rewriting their JSONC or
	// losing their resolution settings, paths, file lists or package type.
	stock.Config = `{"extends":"./` + inputConfig + `","compilerOptions":{
		"noEmit":false,"declaration":true,"emitDeclarationOnly":true,
		"declarationMap":false,"sourceMap":false,"inlineSourceMap":false,
		"composite":false,"incremental":false,"noEmitOnError":false,
		"outDir":"__identity_out","declarationDir":"__identity_out"
	}}`
	vibe.Config = stock.Config
	return stock, vibe, ""
}

// Follow only actual config inheritance, using the compiler's JSONC reader.
// An imported data.json containing "x.ts" must remain byte-for-byte intact.
func declarationIdentityConfigs(project Project) map[string]bool {
	configs := map[string]bool{}
	var visit func(string, string)
	visit = func(name, text string) {
		if configs[name] {
			return
		}
		configs[name] = true
		parsed, _ := tsoptions.ParseConfigFileTextToJson("/identity/tsconfig.json", "/identity/tsconfig.json", text)
		object, ok := parsed.(*collections.OrderedMap[string, any])
		if !ok {
			return // the real compilation reports malformed configurations
		}
		extends, _ := object.Get("extends")
		parents, ok := extends.([]any)
		if !ok {
			parents = []any{extends}
		}
		for _, parent := range parents {
			if parent, ok := parent.(string); ok {
				file := path.Join(path.Dir(name), parent)
				if _, exists := project.Files[file]; !exists {
					file += ".json"
				}
				if text, exists := project.Files[file]; exists {
					visit(file, text)
				}
			}
		}
	}
	visit("tsconfig.json", project.Config)
	return configs
}

func declarationIdentityConfig(text string) string {
	return declarationIdentityTSPath.ReplaceAllStringFunc(text, func(quoted string) string {
		if strings.HasSuffix(quoted, `.d.ts"`) {
			return quoted
		}
		return strings.TrimSuffix(quoted, `.ts"`) + `.vibe"`
	})
}

// compileDeclarationIdentity is shared with the admission test so a change
// that accidentally rejects the oracle's seeds cannot silently pass fuzzing.
func compileDeclarationIdentity(t *testing.T, w *Workspace, archive string) (*Compilation, Project) {
	t.Helper()
	stock, vibe, reason := declarationIdentityProjects(archive)
	if reason != "" {
		t.Skip(reason)
	}
	var c *Compilation
	var err error
	within(t, "compile", func() { c, err = w.CompileOrdered(t.Context(), vibe, OrderTsc, true) })
	if err != nil {
		t.Fatal(err)
	}
	if c.Program == nil || HasError(c.Diagnostics) && !mutabilityErrors(c.Diagnostics) {
		c.Remove()
		t.Skipf(".vibe compilation reports errors: %v", SortedKeys(Keys(c.Dir, c.Diagnostics)))
	}
	for name := range vibe.Files {
		if strings.HasSuffix(name, ".vibe") && c.SourceFile(name) != nil {
			return c, stock
		}
	}
	c.Remove()
	t.Skip("configuration includes no renamed source")
	return c, stock
}

// mutabilityErrors reports whether ds has a write through a readonly member,
// TS2540 or TS2542.
func mutabilityErrors(ds []*ast.Diagnostic) bool {
	for _, d := range ds {
		if d.Code() == 2540 || d.Code() == 2542 {
			return true
		}
	}
	return false
}

// CheckDeclarationIdentity compares one admitted project with stock tsc.
//
// It also enforces principle 4 of docs/design/src/000-intro.md, "TypeScript's
// meaning outside Effect code", for member mutability: Chapter 1 says the
// declaration keeps "exactly the source's written readonly modifiers", so a
// renamed module whose writes stock tsc accepts must not report TS2540 or
// TS2542 (foldkit-10: the checker kept the retired readonly default while the
// declaration printed the members writable).
func CheckDeclarationIdentity(t *testing.T, w *Workspace, tsc, api, archive string) {
	const target = "FuzzDeclarationIdentity"
	defer recoverCompilerPanic(t, target)
	c, stock := compileDeclarationIdentity(t, w, archive)
	defer c.Remove()
	dir := emitDeclarationIdentityStock(t, w, tsc, stock) // skips a program stock tsc rejects
	defer os.RemoveAll(dir)
	if HasError(c.Diagnostics) {
		g := &Gaps{Target: target, Input: SeedName(archive)}
		key := ""
		if name := corpusFile(t, target); name != "" {
			key = "corpus:" + name
			g.Input = "testdata/fuzz/" + target + "/" + name
		}
		g.Add("feature:member-mutability", "000 principle 4, \"TypeScript's meaning outside Effect code\", and Chapter 1, declarations keep \"exactly the source's written readonly modifiers\": stock tsc accepts the program, and the renamed .vibe reports %v", SortedKeys(Keys(c.Dir, c.Diagnostics)))
		g.FinishInput(t, key)
		return
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	current := filepath.Join(c.Dir, "__identity_current")
	if err := os.MkdirAll(current, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, text := range c.Outputs {
		if !isDeclaration(name) {
			continue
		}
		rel, ok := strings.CutPrefix(name, "__identity_out/")
		if !ok {
			t.Fatalf("declaration outside identity outDir: %s", name)
		}
		if err := writeInside(current, rel, text); err != nil {
			t.Fatal(err)
		}
	}
	diff, err := compareIdentityDeclarations(ctx, api, filepath.Join(dir, "__identity_out"), current)
	if err != nil {
		t.Fatal(err)
	}
	g := &Gaps{Target: target, Input: SeedName(archive)}
	key := ""
	if name := corpusFile(t, target); name != "" {
		key = "corpus:" + name
		g.Input = "testdata/fuzz/" + target + "/" + name
	}
	if diff != "" {
		// Pending uses one feature key, so optionally retain every divergent
		// input for campaign triage, including differences that already skip.
		if report := os.Getenv("VIBELANG_FUZZ_DECLARATION_REPORT"); report != "" {
			data, err := json.Marshal(struct{ Input, Archive, Diff string }{g.Input, archive, diff})
			if err != nil {
				t.Fatal(err)
			}
			file, err := os.OpenFile(report, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			_, err = file.Write(append(data, '\n'))
			closeErr := file.Close()
			if err != nil || closeErr != nil {
				t.Fatalf("declaration identity report: write %v; close %v", err, closeErr)
			}
		}
		g.Add("feature:declaration-identity", "Chapter 1: \"Declarations are exactly what idiomatic Effect TypeScript would declare.\" Stock (-) and renamed .vibe (+) canonical declarations differ:\n%s", diff)
	}
	g.FinishInput(t, key)
}

func emitDeclarationIdentityStock(t *testing.T, w *Workspace, tsc string, stock Project) string {
	t.Helper()
	dir, err := w.writeProject(stock)
	if err != nil {
		t.Fatal(err)
	}
	// A skipped baseline must be removed too; a campaign admits many inputs.
	keep := false
	defer func() {
		if !keep {
			os.RemoveAll(dir)
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("stock declaration emit did not finish: %v", ctx.Err())
	}
	if exit, ok := runErr.(*exec.ExitError); runErr != nil && (!ok || exit.ExitCode() != 1 && exit.ExitCode() != 2) {
		t.Fatalf("stock declaration emit failed to run: %v\n%s", runErr, out)
	}
	if runErr != nil {
		// A missing prelude name is intentionally valid only in .vibe;
		// stock's error-recovery `any` is not a TypeScript API contract.
		// This also excludes mutations introducing VibeLang-only syntax.
		t.Skipf("not a valid stock TypeScript project: %s", out)
	}
	keep = true
	return dir
}

func compareIdentityDeclarations(ctx context.Context, api, baseline, current string) (string, error) {
	// Import the actual migration gate, never a Go copy of its equivalence.
	// Added/removed files also show their canonical text in the line diff.
	const script = `import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [gate, api, before, after] = process.argv.slice(1);
const { canonicalize, compareDeclarations, lineDiff } = await import(pathToFileURL(gate));
const ts = createRequire(import.meta.url)(api);
const result = compareDeclarations(ts, before, after);
const diffs = result.changed.map(({file, diff}) => file + "\n" + diff.join("\n"));
for (const file of result.removed) diffs.push(file + " (removed)\n" + lineDiff(canonicalize(ts, readFileSync(join(before, file), "utf8"), file), "").join("\n"));
for (const file of result.added) diffs.push(file + " (added)\n" + lineDiff("", canonicalize(ts, readFileSync(join(after, file), "utf8"), file)).join("\n"));
console.log(JSON.stringify(diffs.join("\n")));`
	gate := filepath.Join(Root(), ".smithers/flows/migrate/lib/declarations.mjs")
	cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, gate, api, baseline, current)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("migration declaration identity gate: %w: %.1200s", err, out)
	}
	var diff string
	if err := json.Unmarshal(out, &diff); err != nil {
		return "", fmt.Errorf("migration declaration identity result: %w: %.600s", err, out)
	}
	return diff, nil
}

func TestDeclarationIdentityAdmission(t *testing.T) {
	if !testing.Short() || toolsFuzzing() {
		t.Skip("checks the ordinary short seed selection")
	}
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	seeds := append([]string{}, ParitySeeds()...)
	for _, args := range CorpusInputs("FuzzDeclarationIdentity") {
		seeds = append(seeds, args[0])
	}
	var admitted atomic.Int64
	t.Run("seeds", func(t *testing.T) {
		for i, archive := range seeds {
			t.Run(fmt.Sprint(i), func(t *testing.T) {
				t.Parallel()
				c, stock := compileDeclarationIdentity(t, w, archive)
				defer c.Remove()
				dir := emitDeclarationIdentityStock(t, w, tsc, stock)
				defer os.RemoveAll(dir)
				admitted.Add(1)
			})
		}
	})
	t.Logf("declaration identity admitted %d/%d short seeds", admitted.Load(), len(seeds))
	if len(seeds) == 0 || admitted.Load()*2 < int64(len(seeds)) {
		t.Fatalf("vacuous declaration oracle: admitted %d/%d short seeds; want at least half", admitted.Load(), len(seeds))
	}
}

func TestDeclarationIdentityRename(t *testing.T) {
	files := map[string]string{
		"main.ts":       "export { value } from \"./other.js\"\n",
		"other.ts":      "export const value: number = 42\n",
		"ambient.d.ts":  "interface Ambient { value: string }\n",
		"data.json":     "{\"name\":\"x.ts\"}\n",
		"package.json":  "{\"type\":\"module\"}\n",
		"base.json":     "{ // JSONC and inheritance remain supported\n\"compilerOptions\":{\"strict\":true,\"module\":\"nodenext\",\"skipLibCheck\":true},\"files\":[\"main.ts\",\"other.ts\",\"ambient.d.ts\"],\"include\":[\"*.ts\"],}\n",
		"tsconfig.json": `{"extends":"./base.json"}`,
	}
	archive := Archive(files)
	stock, vibe, reason := declarationIdentityProjects(archive)
	if reason != "" {
		t.Fatal(reason)
	}
	for _, name := range []string{"main", "other"} {
		if stock.Files[name+".ts"] != files[name+".ts"] || vibe.Files[name+".vibe"] != files[name+".ts"] {
			t.Fatalf("%s source text changed", name)
		}
	}
	for _, name := range []string{"ambient.d.ts", "package.json", "data.json"} {
		if vibe.Files[name] != files[name] {
			t.Fatalf("%s changed", name)
		}
	}
	config := vibe.Files["base.json"]
	for _, name := range []string{`"main.vibe"`, `"other.vibe"`, `"ambient.d.ts"`, `"*.vibe"`} {
		if !strings.Contains(config, name) {
			t.Fatalf("renamed configuration does not contain %s: %s", name, config)
		}
	}
	// The real compiler must resolve the unchanged ./other.js importer to
	// other.vibe, and compare both modules' declarations, not just the entry.
	w := NewWorkspace(t)
	tsc, api := StockTypeScript(t), declarationIdentityAPI(t)
	var child *testing.T
	t.Run("compile", func(t *testing.T) {
		child = t
		CheckDeclarationIdentity(t, w, tsc, api, archive)
	})
	if child.Skipped() {
		t.Fatal("the two-module positive control did not satisfy the oracle")
	}
}

func TestDeclarationIdentityCanonicalization(t *testing.T) {
	api := declarationIdentityAPI(t)
	before, after := t.TempDir(), t.TempDir()
	write := func(dir, name, text string) {
		t.Helper()
		if err := writeInside(dir, name, text); err != nil {
			t.Fatal(err)
		}
	}
	write(before, "main.d.ts", `/** baseline */
export { value } from "./other.ts";
export type Shape = { b: number; a: string } | undefined;`)
	write(after, "main.d.ts", `/** @throws {never} */
export { value } from "./other.js";
export type Shape = undefined | { a: string; b: number };`)
	diff, err := compareIdentityDeclarations(t.Context(), api, before, after)
	if err != nil || diff != "" {
		t.Fatalf("migration equivalence: %v\n%s", err, diff)
	}
	write(before, "changed.d.ts", "export declare const value: string;\n")
	write(after, "changed.d.ts", "export declare const value: number;\n")
	write(before, "removed.d.ts", "export declare const removed: boolean;\n")
	write(after, "added.d.ts", "export declare const added: boolean;\n")
	diff, err = compareIdentityDeclarations(t.Context(), api, before, after)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{
		"-1: export declare const value: string;", "+1: export declare const value: number;",
		"removed.d.ts (removed)", "-1: export declare const removed: boolean;",
		"added.d.ts (added)", "+1: export declare const added: boolean;",
	} {
		if !strings.Contains(diff, line) {
			t.Errorf("declaration difference lacks %q:\n%s", line, diff)
		}
	}
}

func TestDeclarationIdentityRejectsStockErrors(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	for name, source := range map[string]string{
		"prelude-only": `export const value = pipe(1, (n: number) => n + 1)`,
		"vibe-only":    `export effect function value() { return 1 }`,
	} {
		var child *testing.T
		compiled := false
		t.Run(name, func(t *testing.T) {
			child = t
			c, stock := compileDeclarationIdentity(t, w, Archive(map[string]string{"main.ts": source}))
			defer c.Remove()
			compiled = true
			dir := emitDeclarationIdentityStock(t, w, tsc, stock)
			defer os.RemoveAll(dir)
		})
		if !compiled || !child.Skipped() {
			t.Errorf("%s: compared an invalid TypeScript source's recovery declarations", name)
		}
	}
}
