// Command vibelang-forms generates the forms table that VibeLang's text-only
// projector reads (internal/vibelangmapper/forms.go, language change L1).
//
//	cd typescript/tsc && go run ./cmd/vibelang-forms [-o table.jsonl]
//
// It loads effect, the @effect/* packages the corpus uses, and
// vibelang-runtime's sources through the fork's checker, walks every callable
// export of every module the packages' exports maps publish, and classifies each signature's
// declared parameters with the fork's own classifier (vibelang.FormsOfType,
// the code behind D56, D147, D188, D7, and D49). The output is sorted and
// holds no machine paths, so the same inputs always give the same bytes;
// scripts/check-forms-table.sh regenerates it and fails on any difference.
//
// Inputs, by default relative to the repository root:
//
//	-node-modules docs/tools/node_modules   effect and @effect/*, pinned by docs/tools/bun.lock
//	-runtime      packages/runtime/src      vibelang-runtime's TypeScript sources
package main

import (
	"cmp"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// Command is what the table's header names as the way to regenerate it.
const Command = "scripts/check-forms-table.sh --write"

// runtimeModules are vibelang-runtime's public modules, which its sources
// declare: its package.json maps them to dist, which the generator does not
// read.
var runtimeModules = []string{"vibelang-runtime", "vibelang-runtime/kernel"}

// methodModules are effect's modules whose data types take the module's
// self-first functions as methods (D152). It mirrors methodModules in
// internal/vibelang/datamethods.go, which is not exported.
var methodModules = []string{"BigDecimal", "Cause", "Chunk", "DateTime", "Deferred", "Duration", "Effect", "Exit", "Fiber",
	"HashMap", "HashSet", "Option", "Queue", "Ref", "Result", "Schedule", "Sink", "Stream"}

// libReceivers are the lib's types whose own methods a lambda is most
// often passed to: xs.map(f), promise.then(f), set.forEach(f).
var libReceivers = []string{"Array", "ReadonlyArray", "Map", "ReadonlyMap", "Set", "ReadonlySet", "Promise"}

// distPackages are the packages whose modules live under dist/, one
// declaration file per module path (package.json maps "./*" to "./dist/*").
var distPackages = []string{"effect", "@effect/vitest", "@effect/platform-node", "@effect/platform-bun"}

func main() {
	repo := flag.String("repo", "", "repository root (default: found from the working directory)")
	nodeModules := flag.String("node-modules", "", "directory holding effect and @effect/* (default docs/tools/node_modules)")
	runtime := flag.String("runtime", "", "vibelang-runtime's source directory (default packages/runtime/src)")
	out := flag.String("o", "", "output file (default stdout)")
	decisions := flag.String("decisions", "", "also write the decision snapshot here (see decisions.go)")
	previous := flag.String("previous", "", "the committed decision snapshot: fail if a decision moved without an approval")
	approved := flag.String("approved", "", "the approvals file for -previous")
	stats := flag.Bool("stats", false, "print counts and timing to stderr")
	legacy := flag.String("legacy", "", "write the checked decision-1 legacy oracle to this file (- for stdout); no forms table is generated")
	flag.Parse()
	root := *repo
	if root == "" {
		var err error
		if root, err = findRepo(); err != nil {
			fail(err)
		}
	}
	if *nodeModules == "" {
		*nodeModules = filepath.Join(root, "docs", "tools", "node_modules")
	}
	if *runtime == "" {
		*runtime = filepath.Join(root, "packages", "runtime", "src")
	}
	if *legacy != "" {
		data, err := legacyOracle(root, *nodeModules)
		if err != nil {
			fail(err)
		}
		if *legacy == "-" {
			_, err = os.Stdout.Write(data)
		} else {
			err = os.WriteFile(*legacy, data, 0o644)
		}
		if err != nil {
			fail(err)
		}
		return
	}
	start := time.Now()
	g, err := generate(must(filepath.Abs(*nodeModules)), must(filepath.Abs(*runtime)))
	if err != nil {
		fail(err)
	}
	var lines []string
	if *decisions != "" {
		table := vibelangmapper.NewTable(g.header, g.entries, g.aliases)
		table.SetValues(g.values)
		table.SetModules(g.modules)
		if lines, err = decisionLines(root, table); err != nil {
			fail(err)
		}
		if *previous != "" {
			prev, err := readLines(*previous)
			if err != nil {
				fail(err)
			}
			approvals, err := readLines(*approved)
			if err != nil {
				fail(err)
			}
			if moved := unapprovedMoves(prev, lines, approvals); len(moved) > 0 {
				fmt.Fprintf(os.Stderr, "vibelang-forms: %d decisions moved without an approval; add each line, with a reason after #, to %s:\n", len(moved), *approved)
				for _, m := range moved {
					fmt.Fprintln(os.Stderr, "  "+m)
				}
				os.Exit(1)
			}
		}
	}
	var w io.Writer = os.Stdout
	var f *os.File
	if *out != "" {
		if f, err = os.Create(*out); err != nil {
			fail(err)
		}
		w = f
	}
	if err := vibelangmapper.WriteTable(w, g.header, g.modules, g.entries, g.aliases, g.values); err != nil {
		fail(err)
	}
	if f != nil {
		if err := f.Close(); err != nil {
			fail(err)
		}
	}
	if *decisions != "" {
		if err := writeLines(*decisions, lines); err != nil {
			fail(err)
		}
	}
	if *stats {
		sigs, formKeys := 0, 0
		for _, s := range g.entries {
			sigs += len(s)
			formKeys++
		}
		fmt.Fprintf(os.Stderr, "vibelang-forms: %d keys (%d signatures), %d aliases, %d callable exports walked, %s\n",
			formKeys, sigs, len(g.aliases), g.walked, time.Since(start).Round(time.Millisecond))
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		fail(err)
	}
	return v
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "vibelang-forms:", err)
	os.Exit(1)
}

// findRepo returns the directory above the working directory that holds
// typescript/tsc/go.mod.
func findRepo() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "typescript", "tsc", "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no repository root above the working directory; pass -repo")
		}
		dir = parent
	}
}

type generated struct {
	header  vibelangmapper.Header
	modules []string
	entries map[string][]vibelangmapper.Signature
	aliases map[string]string
	values  map[string]string
	walked  int
}

// generate builds a program whose one root file, a .vibe file kept in
// memory, imports every published module as a namespace, and walks them.
func generate(nodeModules, runtime string) (*generated, error) {
	for _, pkg := range distPackages {
		if _, err := os.Stat(filepath.Join(nodeModules, pkg, "package.json")); err != nil {
			return nil, fmt.Errorf("%s is not installed in %s (run bun install in docs/tools): %w", pkg, nodeModules, err)
		}
	}
	if _, err := os.Stat(filepath.Join(runtime, "index.ts")); err != nil {
		return nil, fmt.Errorf("no vibelang-runtime sources: %w", err)
	}
	modules, err := publishedModules(nodeModules)
	if err != nil {
		return nil, err
	}
	modules = append(modules, runtimeModules...)
	// The program's own directory exists only in memory. Every package is
	// reached through paths, so one copy of effect serves the runtime's
	// sources and the @effect packages alike.
	dir := filepath.ToSlash(filepath.Join(filepath.Dir(runtime), ".vibelang-forms"))
	paths := map[string][]string{
		"vibelang-runtime":        {filepath.ToSlash(filepath.Join(runtime, "index.ts"))},
		"vibelang-runtime/kernel": {filepath.ToSlash(filepath.Join(runtime, "kernel", "kernel.ts"))},
	}
	for _, pkg := range distPackages {
		if err := exportPaths(paths, nodeModules, pkg); err != nil {
			return nil, err
		}
	}
	config, _ := json.Marshal(map[string]any{
		"compilerOptions": map[string]any{
			"target": "es2022", "lib": []string{"esnext", "dom"}, "module": "nodenext", "moduleResolution": "nodenext",
			"strict": true, "types": []string{}, "skipLibCheck": true, "noEmit": true, "resolveJsonModule": true, "paths": paths,
		},
		"files": []string{"forms.vibe"},
	})
	var source strings.Builder
	for i, m := range modules {
		fmt.Fprintf(&source, "import * as M%d from %q\n", i, m)
	}
	source.WriteString("export const keep = [")
	for i := range modules {
		if i > 0 {
			source.WriteString(", ")
		}
		fmt.Fprintf(&source, "M%d", i)
	}
	source.WriteString("]\n")
	virtual := map[string]string{dir + "/tsconfig.json": string(config), dir + "/forms.vibe": source.String()}
	fs := memoryOverlay(bundled.WrapFS(osvfs.FS()), dir, virtual)
	parsed, diags := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(dir+"/tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
	if len(diags) != 0 {
		return nil, fmt.Errorf("tsconfig: %v", diags[0].String())
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	p.BindSourceFiles()
	file := p.GetSourceFile(tspath.RootedFilePathFromAbsolute(dir + "/forms.vibe"))
	if file == nil {
		return nil, fmt.Errorf("the root file did not load")
	}
	if err := rejectDiagnostics(p, runtime); err != nil {
		return nil, err
	}
	c, done := p.GetTypeChecker(context.Background())
	defer done()
	w := &walker{c: c, runtime: runtime, nodeModules: nodeModules, reach: map[*ast.Symbol][]reached{}, modulePaths: map[*ast.Symbol]string{}, sigs: map[string][]vibelangmapper.Signature{}, aliases: map[string]string{}, valueTypes: map[string]string{}}
	for i, statement := range file.Statements.Nodes {
		if statement.Kind != ast.KindImportDeclaration {
			continue
		}
		module := c.ResolveExternalModuleName(statement.ModuleSpecifier(), nil)
		if module == nil {
			return nil, fmt.Errorf("cannot resolve %s", modules[i])
		}
		w.enqueue(module, modules[i])
	}
	w.run()
	w.prelude(file)
	entries := w.finish()
	w.methods(entries)
	values := w.receiverModules(entries)
	g := &generated{entries: entries, aliases: w.aliases, values: values, walked: w.walked}
	inputs, err := pinInputs(p, runtime)
	if err != nil {
		return nil, err
	}
	var methodPaths []string
	for _, m := range methodModules {
		methodPaths = append(methodPaths, "effect/"+m)
	}
	g.header = vibelangmapper.Header{Notice: "generated; do not edit", Command: Command, Rules: vibelangmapper.RulesVersion, Inputs: inputs, MethodModules: methodPaths}
	g.modules = modules
	return g, nil
}

// publishedModules lists every module the dist packages publish: each
// exact subpath of a package.json exports map, and each declaration file a
// wildcard subpath reaches, less the subpaths it maps to null (internal/*,
// */index). It is the table's coverage, so a callee from any published
// module has a key.
func publishedModules(nodeModules string) ([]string, error) {
	var out []string
	for _, pkg := range distPackages {
		root := filepath.Join(nodeModules, pkg)
		data, err := os.ReadFile(filepath.Join(root, "package.json"))
		if err != nil {
			return nil, err
		}
		var manifest struct {
			Exports map[string]json.RawMessage `json:"exports"`
		}
		if err := json.Unmarshal(data, &manifest); err != nil {
			return nil, fmt.Errorf("%s/package.json: %w", root, err)
		}
		var excluded []string
		subpaths := map[string]bool{}
		wildcard := ""
		for sub, raw := range manifest.Exports {
			switch {
			case string(raw) == "null":
				excluded = append(excluded, sub)
			case sub == "./package.json":
			case strings.Contains(sub, "*"):
				var target string
				if json.Unmarshal(raw, &target) == nil && sub == "./*" {
					wildcard = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSuffix(target, "*.js"), "./"), "/")
				}
			default:
				subpaths[sub] = true
			}
		}
		if wildcard != "" {
			dist := filepath.Join(root, filepath.FromSlash(wildcard))
			err := filepath.WalkDir(dist, func(path string, d os.DirEntry, err error) error {
				if err != nil || d.IsDir() || !strings.HasSuffix(path, ".d.ts") {
					return err
				}
				rel, _ := filepath.Rel(dist, path)
				sub := "./" + strings.TrimSuffix(filepath.ToSlash(rel), ".d.ts")
				for _, x := range excluded {
					if matchSubpath(x, sub) {
						return nil
					}
				}
				subpaths[sub] = true
				return nil
			})
			if err != nil {
				return nil, err
			}
		}
		for sub := range subpaths {
			out = append(out, pkg+strings.TrimPrefix(sub, "."))
		}
	}
	sort.Strings(out)
	return out, nil
}

// matchSubpath reports whether sub matches an exports pattern with at
// most one *, as Node matches subpath patterns.
func matchSubpath(pattern, sub string) bool {
	before, after, wild := strings.Cut(pattern, "*")
	if !wild {
		return pattern == sub
	}
	return len(sub) >= len(before)+len(after) && strings.HasPrefix(sub, before) && strings.HasSuffix(sub, after)
}

// rejectDiagnostics fails generation on any diagnostic of the program:
// options, syntax in any file, and semantics in the root and the runtime's
// sources. A broken declaration would otherwise erase types silently.
func rejectDiagnostics(p *compiler.Program, runtime string) error {
	ctx := context.Background()
	diags := append([]*ast.Diagnostic{}, p.GetConfigFileParsingDiagnostics()...)
	diags = append(diags, p.GetProgramDiagnostics()...)
	diags = append(diags, p.GetSyntacticDiagnostics(ctx, nil)...)
	diags = append(diags, p.GetGlobalDiagnostics(ctx)...)
	for _, f := range p.SourceFiles() {
		if f.IsDeclarationFile && !strings.HasPrefix(string(f.FileName()), filepath.ToSlash(runtime)+"/") {
			continue
		}
		if strings.HasPrefix(string(f.FileName()), "bundled:") {
			continue
		}
		diags = append(diags, p.GetSemanticDiagnostics(ctx, f)...)
	}
	if len(diags) == 0 {
		return nil
	}
	var b strings.Builder
	for i, d := range diags {
		if i == 5 {
			fmt.Fprintf(&b, "\n  … %d more", len(diags)-5)
			break
		}
		name := ""
		if d.File() != nil {
			name = string(d.File().FileName()) + ": "
		}
		fmt.Fprintf(&b, "\n  %s%s", name, d.String())
	}
	return fmt.Errorf("the program has %d diagnostics:%s", len(diags), b.String())
}

// exportPaths adds a paths entry for each subpath pkg's package.json
// exports, pointing at its declaration file: "./schema" at
// dist/schema/index.d.ts and "./*" at dist/*.d.ts. As in module resolution,
// an exact subpath wins over the wildcard, which matters on a
// case-insensitive file system where effect/schema could match Schema.d.ts.
func exportPaths(paths map[string][]string, nodeModules, pkg string) error {
	root := filepath.ToSlash(filepath.Join(nodeModules, pkg))
	data, err := os.ReadFile(filepath.Join(nodeModules, pkg, "package.json"))
	if err != nil {
		return err
	}
	var manifest struct {
		Exports map[string]json.RawMessage `json:"exports"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("%s/package.json: %w", root, err)
	}
	for sub, raw := range manifest.Exports {
		var target string
		if json.Unmarshal(raw, &target) != nil {
			var conditions map[string]string
			if json.Unmarshal(raw, &conditions) != nil {
				continue // null: not exported
			}
			target = cmp.Or(conditions["types"], conditions["import"], conditions["default"])
		}
		if target == "" || strings.HasSuffix(sub, "/index") {
			continue
		}
		name := pkg + strings.TrimPrefix(sub, ".")
		if !strings.HasSuffix(target, ".json") && !tspath.IsDeclarationFileName(target) {
			target = strings.TrimSuffix(target, ".js") + ".d.ts"
		}
		paths[name] = []string{root + "/" + strings.TrimPrefix(target, "./")}
	}
	return nil
}

// memoryOverlay serves files, held in memory under dir, over fs.
func memoryOverlay(fs vfs.FS, dir string, files map[string]string) vfs.FS {
	inDir := func(p string) bool { return p == dir || strings.HasPrefix(p, dir+"/") }
	return wrapvfs.Wrap(fs, wrapvfs.Replacements{
		FileExists: func(p tspath.RootedFilePath) bool {
			if _, ok := files[string(p)]; ok {
				return true
			}
			return !inDir(string(p)) && fs.FileExists(p)
		},
		ReadFile: func(p tspath.RootedFilePath) (string, bool) {
			if text, ok := files[string(p)]; ok {
				return text, true
			}
			if inDir(string(p)) {
				return "", false
			}
			return fs.ReadFile(p)
		},
		DirectoryExists: func(p tspath.RootedDirectoryPath) bool {
			if string(p) == dir {
				return true
			}
			return !inDir(string(p)) && fs.DirectoryExists(p)
		},
		Realpath: func(p tspath.RootedPath) tspath.RootedPath {
			if inDir(string(p)) {
				return p
			}
			return fs.Realpath(p)
		},
	})
}

// reached is one key under which the walk reached a value.
type reached struct {
	module string // the module path the walk was in
	key    string
	order  int
}

type walker struct {
	c           *checker.Checker
	runtime     string
	nodeModules string
	realDist    map[string]string // package -> resolved dist directory, cached for linked installs
	queue       []*ast.Symbol
	modulePaths map[*ast.Symbol]string // module symbol -> module path
	reach       map[*ast.Symbol][]reached
	values      []*ast.Symbol // in the order first reached
	sigs        map[string][]vibelangmapper.Signature
	aliases     map[string]string
	valueTypes  map[string]string // canonical key of a value export -> the module of its type
	order       int
	walked      int
}

// enqueue schedules module for walking under path, once.
func (w *walker) enqueue(module *ast.Symbol, path string) {
	if _, ok := w.modulePaths[module]; ok {
		return
	}
	w.modulePaths[module] = path
	w.queue = append(w.queue, module)
}

func (w *walker) run() {
	for i := 0; i < len(w.queue); i++ {
		module := w.queue[i]
		path := w.modulePaths[module]
		w.walkExports(module, path, path+"#", 0)
	}
}

// walkExports walks the exports of module, a source file or a namespace,
// under keys that start with prefix.
func (w *walker) walkExports(module *ast.Symbol, path, prefix string, depth int) {
	exports := w.c.GetExportsOfModule(module)
	names := make([]string, 0, len(exports))
	byName := map[string]*ast.Symbol{}
	for _, e := range exports {
		names = append(names, e.Name())
		byName[e.Name()] = e
	}
	sort.Strings(names)
	for _, name := range names {
		if strings.HasPrefix(name, "\xfe") || strings.HasPrefix(name, "__") || name == "default" && depth > 0 {
			continue
		}
		key := prefix + name
		target := byName[name]
		if target.Flags()&ast.SymbolFlagsAlias != 0 {
			target = w.c.GetAliasedSymbol(target)
		}
		if target == nil || target.Flags()&ast.SymbolFlagsValue == 0 {
			continue
		}
		if isNamespace(target) {
			if modulePath := w.modulePathOf(target); modulePath != "" {
				// Another module, exported as a namespace: walk it under its
				// own path, and alias this name to it.
				if modulePath != path {
					w.aliases[key] = modulePath
				}
				w.enqueue(target, modulePath)
				continue
			}
			if depth < 2 {
				w.walkExports(target, path, key+".", depth+1)
			}
			continue
		}
		w.reachValue(target, path, key)
	}
}

// reachValue records that the walk reached value under key.
func (w *walker) reachValue(value *ast.Symbol, module, key string) {
	if _, seen := w.reach[value]; !seen {
		w.values = append(w.values, value)
	}
	w.order++
	w.reach[value] = append(w.reach[value], reached{module: module, key: key, order: w.order})
}

// isNamespace reports whether symbol is a module or a namespace that is not
// also a function, class, or variable.
func isNamespace(symbol *ast.Symbol) bool {
	return symbol.Flags()&(ast.SymbolFlagsValueModule|ast.SymbolFlagsNamespaceModule) != 0 &&
		symbol.Flags()&(ast.SymbolFlagsFunction|ast.SymbolFlagsVariable|ast.SymbolFlagsClass) == 0
}

// modulePathOf returns the module path that a module symbol's source file
// is published under, or "" when it is not a public module of a covered
// package: effect/Effect for .../effect/dist/Effect.d.ts, effect/http for
// .../effect/dist/http/index.d.ts, vibelang-runtime for the runtime's index.ts.
func (w *walker) modulePathOf(symbol *ast.Symbol) string {
	for _, d := range symbol.Declarations() {
		if d.Kind == ast.KindSourceFile {
			return w.publicPath(string(d.AsSourceFile().FileName()))
		}
	}
	return ""
}

func (w *walker) publicPath(file string) string {
	runtime := filepath.ToSlash(w.runtime)
	switch file {
	case runtime + "/index.ts":
		return "vibelang-runtime"
	case runtime + "/kernel/kernel.ts":
		return "vibelang-runtime/kernel"
	}
	for _, pkg := range distPackages {
		dist := filepath.ToSlash(filepath.Join(w.nodeModules, pkg, "dist")) + "/"
		rel, ok := strings.CutPrefix(file, dist)
		if !ok {
			// The checker resolves package symlinks. Keep the same public
			// module identity when node_modules links into another checkout.
			if w.realDist == nil {
				w.realDist = map[string]string{}
			}
			real, cached := w.realDist[pkg]
			if !cached {
				real, _ = filepath.EvalSymlinks(filepath.FromSlash(strings.TrimSuffix(dist, "/")))
				w.realDist[pkg] = real
			}
			if real != "" {
				rel, ok = strings.CutPrefix(file, filepath.ToSlash(real)+"/")
			}
		}
		if !ok || !strings.HasSuffix(rel, ".d.ts") {
			continue
		}
		rel = strings.TrimSuffix(rel, ".d.ts")
		rel = strings.TrimSuffix(strings.TrimSuffix(rel, "index"), "/")
		if strings.Contains(rel, "internal") {
			return ""
		}
		if rel == "" {
			return pkg
		}
		return pkg + "/" + rel
	}
	return ""
}

// finish picks each value's canonical key, records its signatures and its
// callable members under that key, and aliases the other keys it was
// reached under.
func (w *walker) finish() map[string][]vibelangmapper.Signature {
	entries := map[string][]vibelangmapper.Signature{}
	for _, value := range w.values {
		reach := w.reach[value]
		home := w.homeOf(value)
		canonical := reach[0]
		for _, r := range reach {
			if r.module == home {
				canonical = r
				break
			}
		}
		for _, r := range reach {
			if r.key != canonical.key && !w.coveredByAlias(r.key, canonical.key) {
				w.aliases[r.key] = canonical.key
			}
		}
		t := w.c.GetTypeOfSymbol(value)
		if m := w.typeModule(t); m != "" {
			w.valueTypes[canonical.key] = m
		}
		w.record(entries, canonical.key, t, 0)
	}
	return entries
}

// typeModule returns the module path that declares t's type, or "".
func (w *walker) typeModule(t *checker.Type) string {
	if t == nil {
		return ""
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		home := ""
		for _, member := range t.Types() {
			m := w.typeModule(member)
			if m == "" || home != "" && m != home {
				return ""
			}
			home = m
		}
		return home
	}
	symbol := t.Symbol()
	if symbol == nil || strings.HasPrefix(symbol.Name(), "__") || symbol.Flags()&(ast.SymbolFlagsInterface|ast.SymbolFlagsClass|ast.SymbolFlagsTypeAlias) == 0 {
		return "" // a function or object literal type is no receiver
	}
	if slices.Contains(libReceivers, symbol.Name()) {
		for _, d := range symbol.Declarations() {
			if file := ast.GetSourceFileOfNode(d); file != nil && strings.HasPrefix(string(file.FileName()), "bundled:") {
				return "lib/" + symbol.Name() // the lib's own Array, Map, Set, or Promise
			}
		}
	}
	// An interface merged across files belongs to the module named like it:
	// Stream to effect/Stream, not to a module that augments it.
	home := ""
	for _, d := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(d)
		if file == nil {
			continue
		}
		path := w.publicPath(string(file.FileName()))
		if path != "" && path[strings.LastIndex(path, "/")+1:] == symbol.Name() {
			return path
		}
		if home == "" {
			home = path
		}
	}
	return home
}

// nodeModule returns the module a written return type names when the type
// itself does not: a conditional type whose branches agree (Effect.all's
// All.Return picks among Effect shapes; a never branch says nothing), a
// type alias, followed to its declaration, or, for a dual's conditional
// return (Effect.forkScoped: an Effect when given one, else a data-last
// function), a function branch of the conditional whose first parameter is
// an Effect, which counts as the module of its own result. A data-last
// signature's own function result names no module. Calls of such a function only
// build a description, so the resolver may treat their result as that
// module's.
func (w *walker) nodeModule(node *ast.Node, depth int, branch bool) string {
	if node == nil || depth > 6 {
		return ""
	}
	c := w.c
	switch node.Kind {
	case ast.KindParenthesizedType:
		return w.nodeModule(node.Type(), depth+1, branch)
	case ast.KindNeverKeyword:
		return "never"
	case ast.KindConditionalType:
		cond := node.AsConditionalTypeNode()
		return agree(w.nodeModule(cond.TrueType, depth+1, true), w.nodeModule(cond.FalseType, depth+1, true))
	case ast.KindUnionType:
		module := "never"
		for _, member := range node.AsUnionTypeNode().Types.Nodes {
			if module = agree(module, w.nodeModule(member, depth+1, branch)); module == "" {
				return ""
			}
		}
		return module
	case ast.KindFunctionType:
		if !branch {
			return "" // a data-last signature returns a function, not its result
		}
		params := node.Parameters()
		if len(params) == 0 {
			return ""
		}
		if _, effect := vibelang.FormsOfType(c, c.GetTypeFromTypeNode(params[0].Type())); !effect {
			return ""
		}
		return w.nodeModule(node.Type(), depth+1, false)
	case ast.KindTypeReference:
		if m := w.typeModule(c.GetTypeFromTypeNode(node)); m != "" {
			return m
		}
		// A type alias: follow its declaration.
		name := node.AsTypeReferenceNode().TypeName
		symbol := c.GetSymbolAtLocation(name)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsTypeAlias != 0 {
			for _, d := range symbol.Declarations() {
				if d.Kind == ast.KindTypeAliasDeclaration {
					return w.nodeModule(d.Type(), depth+1, branch)
				}
			}
		}
	}
	return ""
}

// agree joins two branch modules: never says nothing, and different
// modules give none.
func agree(a, b string) string {
	switch {
	case a == "never":
		return b
	case b == "never" || a == b:
		return a
	}
	return ""
}

// receiverModules keeps the result modules that name a receiver with
// methods (a D152 method module, or a module whose main type has own
// methods) and drops the rest. It returns the value exports whose type is
// such a receiver.
func (w *walker) receiverModules(entries map[string][]vibelangmapper.Signature) map[string]string {
	receivers := map[string]bool{}
	for _, m := range methodModules {
		receivers["effect/"+m] = true
	}
	for _, m := range libReceivers {
		receivers["lib/"+m] = true
	}
	for key := range entries {
		if rest, ok := strings.CutPrefix(key, "method:"); ok {
			receivers[rest[:strings.IndexByte(rest, '#')]] = true
		}
	}
	for key, sigs := range entries {
		for i := range sigs {
			if !receivers[sigs[i].Result] { // "" and "never" included
				sigs[i].Result = ""
			}
			if !receivers[sigs[i].Runs] {
				sigs[i].Runs = ""
			}
		}
		if !carriesForm(sigs) && !hasResult(sigs) {
			delete(entries, key)
			continue
		}
		entries[key] = sigs
	}
	values := map[string]string{}
	for key, m := range w.valueTypes {
		if receivers[m] {
			values[key] = m
		}
	}
	return values
}

// methods records the own methods of the lib's collection types and of
// each effect module's main type (the interface or class named like the
// module, as Semaphore in effect/Semaphore), keyed method:<receiver>#<name>.
// A method module's self-first functions need no entries: the resolver
// reads them from the module's own keys (Signature.Self).
func (w *walker) methods(entries map[string][]vibelangmapper.Signature) {
	for _, name := range libReceivers {
		if symbol := w.c.GlobalSymbol(name, ast.SymbolFlagsType); symbol != nil {
			w.ownMethods(entries, "method:lib/"+name, w.c.GetDeclaredTypeOfSymbol(symbol))
		}
	}
	paths := make([]string, 0, len(w.modulePaths))
	byPath := map[string]*ast.Symbol{}
	for module, path := range w.modulePaths {
		paths = append(paths, path)
		byPath[path] = module
	}
	sort.Strings(paths)
	for _, path := range paths {
		if !strings.HasPrefix(path, "effect/") {
			continue
		}
		base := path[strings.LastIndex(path, "/")+1:]
		for _, e := range w.c.GetExportsOfModule(byPath[path]) {
			if e.Name() != base {
				continue
			}
			target := e
			if target.Flags()&ast.SymbolFlagsAlias != 0 {
				target = w.c.GetAliasedSymbol(target)
			}
			if target != nil && target.Flags()&(ast.SymbolFlagsInterface|ast.SymbolFlagsClass) != 0 {
				w.ownMethods(entries, "method:"+path, w.c.GetDeclaredTypeOfSymbol(target))
			}
		}
	}
}

// ownMethods records the callable members of t that carry a form.
func (w *walker) ownMethods(entries map[string][]vibelangmapper.Signature, prefix string, t *checker.Type) {
	if t == nil {
		return
	}
	for _, prop := range w.c.GetPropertiesOfType(t) {
		name := prop.Name()
		if skipMembers[name] || strings.HasPrefix(name, "\xfe") || strings.HasPrefix(name, "__@") || strings.HasPrefix(name, "~") {
			continue
		}
		pt := w.c.GetTypeOfSymbol(prop)
		if pt == nil {
			continue
		}
		if sigs := w.signatures(pt); len(sigs) > 0 && carriesForm(sigs) {
			entries[prefix+"#"+name] = sigs
		}
	}
}

// homeOf returns the module path of the file that declares value.
func (w *walker) homeOf(value *ast.Symbol) string {
	for _, d := range value.Declarations() {
		if file := ast.GetSourceFileOfNode(d); file != nil {
			return w.publicPath(string(file.FileName()))
		}
	}
	return ""
}

// coveredByAlias reports whether a module alias already leads key to
// canonical, as effect#Effect leads effect#Effect.forEach to
// effect/Effect#forEach.
func (w *walker) coveredByAlias(key, canonical string) bool {
	t := vibelangmapper.NewTable(vibelangmapper.Header{}, nil, w.aliases)
	return t.Canonical(key) == canonical
}

var skipMembers = map[string]bool{"prototype": true, "call": true, "apply": true, "bind": true, "toString": true, "length": true, "name": true, "caller": true, "arguments": true}

// record adds t's call signatures under key when one carries a form, then
// does the same for t's callable members, two levels deep (it.effect.each).
func (w *walker) record(entries map[string][]vibelangmapper.Signature, key string, t *checker.Type, depth int) {
	if t == nil {
		return
	}
	if sigs := w.signatures(t); len(sigs) > 0 {
		w.walked++
		if carriesForm(sigs) || hasResult(sigs) {
			entries[key] = sigs // receiverModules drops the form-less ones whose result names no receiver
		}
	}
	if depth >= 2 || t.Flags()&checker.TypeFlagsObject == 0 {
		return
	}
	props := w.c.GetPropertiesOfType(t)
	if len(props) > 200 {
		return
	}
	for _, prop := range props {
		name := prop.Name()
		if skipMembers[name] || strings.HasPrefix(name, "\xfe") || strings.HasPrefix(name, "__@") || strings.HasPrefix(name, "~") {
			continue
		}
		if _, exists := entries[key+"."+name]; exists {
			continue
		}
		pt := w.c.GetTypeOfSymbol(prop)
		if pt == nil || len(w.c.GetSignaturesOfType(pt, checker.SignatureKindCall)) == 0 {
			continue
		}
		w.record(entries, key+"."+name, pt, depth+1)
	}
}

func hasResult(sigs []vibelangmapper.Signature) bool {
	for _, s := range sigs {
		if s.Result != "" || s.Runs != "" {
			return true
		}
	}
	return false
}

func carriesForm(sigs []vibelangmapper.Signature) bool {
	for _, s := range sigs {
		if s.DataFirst || s.DataLast {
			return true
		}
		for _, p := range s.Params {
			if !p.IsZero() {
				return true
			}
		}
	}
	return false
}

// noiseProps are members that every object or array type has; their
// classes say nothing about an object literal written at the position.
var noiseProps = map[string]bool{"pipe": true, "toJSON": true, "toString": true, "valueOf": true, "toLocaleString": true, "hasOwnProperty": true, "isPrototypeOf": true, "propertyIsEnumerable": true,
	"at": true, "concat": true, "copyWithin": true, "entries": true, "every": true, "fill": true, "filter": true, "find": true, "findIndex": true, "findLast": true, "findLastIndex": true, "flat": true, "flatMap": true,
	"forEach": true, "includes": true, "indexOf": true, "join": true, "keys": true, "lastIndexOf": true, "map": true, "pop": true, "push": true, "reduce": true, "reduceRight": true, "reverse": true, "shift": true,
	"slice": true, "some": true, "sort": true, "splice": true, "unshift": true, "values": true, "toReversed": true, "toSorted": true, "toSpliced": true, "with": true}

// anyProperty is a property name no type declares, so classifying it reads
// a type's string index signature, as the checker does for an object
// literal property the type does not name.
const anyProperty = "\x00any"

// signatures reads t's call signatures as the table stores them.
func (w *walker) signatures(t *checker.Type) []vibelangmapper.Signature {
	c := w.c
	var out []vibelangmapper.Signature
	for _, sig := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
		declared := declaredSignature(c, sig)
		n := len(declared.Parameters())
		ret := c.GetReturnTypeOfSignature(declared)
		s := vibelangmapper.Signature{Min: declared.MinArgumentCount(), Max: n, Rest: declared.HasRestParameter(), Result: w.typeModule(ret)}
		if s.Result == "" {
			if d := declared.Declaration(); d != nil && d.Type() != nil {
				s.Result = w.nodeModule(d.Type(), 0, false)
			}
		}
		if _, effect := vibelang.FormsOfType(c, ret); effect {
			if args := c.GetTypeArguments(ret); len(args) > 0 {
				s.Runs = w.typeModule(args[0])
			}
		}
		for i := range n {
			s.Params = append(s.Params, w.param(c.GetTypeAtPosition(declared, i)))
		}
		if n > 0 {
			_, s.DataFirst = vibelang.FormsOfType(c, c.GetTypeOfSymbol(declared.Parameters()[0]))
			s.Self = vibelang.TakesSelfFirst(declared) // D152 and D295, as the checker decides
		}
		for _, inner := range c.GetSignaturesOfType(c.GetReturnTypeOfSignature(declared), checker.SignatureKindCall) {
			if ps := inner.Parameters(); len(ps) > 0 {
				if _, effect := vibelang.FormsOfType(c, c.GetTypeOfSymbol(ps[0])); effect {
					s.DataLast = true
				}
			}
		}
		out = append(out, s)
	}
	return out
}

// declaredSignature returns the uninstantiated signature behind sig, whose
// declared parameter types the fork classifies (D44).
func declaredSignature(c *checker.Checker, sig *checker.Signature) *checker.Signature {
	if d := sig.Declaration(); d != nil && !ast.IsJSDocSignature(d) && ast.IsFunctionLike(d) {
		return c.GetSignatureFromDeclaration(d)
	}
	for sig.Target() != nil {
		sig = sig.Target()
	}
	return sig
}

// param classifies one declared parameter type: the argument itself, an
// array element, and, when a program does not fit, each property and any
// other property of an object argument.
func (w *walker) param(pt *checker.Type) vibelangmapper.Param {
	var p vibelangmapper.Param
	if pt == nil {
		return p
	}
	c := w.c
	p.Top = class(c, pt)
	p.Elem = class(c, pt, "[]")
	if p.Top&vibelangmapper.ClassProgram != 0 {
		return p
	}
	base := pt
	for base.Flags()&checker.TypeFlagsSubstitution != 0 {
		base = base.AsSubstitutionType().BaseType()
	}
	if base.Flags()&checker.TypeFlagsTypeParameter != 0 {
		if k := c.GetBaseConstraintOfType(base); k != nil {
			base = k
		}
	}
	// An optional parameter's declared type is X | undefined, whose only
	// properties are those of every member: none. Walk X's.
	base = c.GetNonNullableType(base)
	if base.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsUnion|checker.TypeFlagsIntersection) == 0 || len(c.GetSignaturesOfType(base, checker.SignatureKindCall)) != 0 {
		return p
	}
	if props := c.GetPropertiesOfType(base); len(props) <= 200 {
		for _, prop := range props {
			name := prop.Name()
			if noiseProps[name] || strings.HasPrefix(name, "\xfe") || strings.HasPrefix(name, "__@") || strings.HasPrefix(name, "~") {
				continue
			}
			if cls := class(c, pt, name); cls != 0 {
				if p.Props == nil {
					p.Props = map[string]vibelangmapper.Class{}
				}
				p.Props[name] = cls
			}
		}
	}
	p.AnyProp = class(c, pt, anyProperty)
	if p.AnyProp == 0 && len(p.Props) == 0 {
		p.AnyProp = w.mappedTemplateClass(base)
	}
	return p
}

// mappedTemplateClass classifies the template of a mapped type, the type
// every key of a record such as the runtime's Clauses<S, H> or
// Effect.catchTags' handlers gets: generic in its keys, it has no
// properties for the walk to read. A conditional template is read through
// both branches, and an intersection or union through its mapped members. The template is read from the mapped type's declaration,
// since the checker does not export it.
func (w *walker) mappedTemplateClass(t *checker.Type) vibelangmapper.Class {
	if t != nil && t.Flags()&(checker.TypeFlagsIntersection|checker.TypeFlagsUnion) != 0 {
		// catchTags' Cases is { [K in tags]+?: handler } & (…: never for the
		// rest): the mapped members give the record's class.
		var cls vibelangmapper.Class
		for _, member := range t.Types() {
			cls |= w.mappedTemplateClass(member)
		}
		return cls
	}
	if t == nil || t.Flags()&checker.TypeFlagsObject == 0 || t.ObjectFlags()&checker.ObjectFlagsMapped == 0 || t.Symbol() == nil {
		return 0
	}
	for _, d := range t.Symbol().Declarations() {
		if d.Kind != ast.KindMappedType || d.AsMappedTypeNode().Type == nil {
			continue
		}
		template := d.AsMappedTypeNode().Type
		nodes := []*ast.Node{template}
		if template.Kind == ast.KindConditionalType {
			cond := template.AsConditionalTypeNode()
			nodes = []*ast.Node{cond.TrueType, cond.FalseType}
		}
		var cls vibelangmapper.Class
		for _, n := range nodes {
			cls |= class(w.c, w.c.GetTypeFromTypeNode(n))
		}
		return cls
	}
	return 0
}

func class(c *checker.Checker, t *checker.Type, steps ...string) vibelangmapper.Class {
	forms, _ := vibelang.FormsOfType(c, t, steps...)
	cls, err := vibelangmapper.ParseClass(forms)
	if err != nil {
		fail(err)
	}
	return cls
}

// prelude aliases each prelude name (D4, D48), effect root export (D146),
// and unprefixed Effect function (D151) to its canonical key or module,
// asking the fork's own name resolution in a .vibe file which names are
// in scope and what they mean.
func (w *walker) prelude(file *ast.SourceFile) {
	location := file.Statements.Nodes[len(file.Statements.Nodes)-1]
	candidates := map[string]bool{}
	for module, path := range w.modulePaths {
		if path == "effect" || path == "effect/Effect" || path == "vibelang-runtime" {
			for _, e := range w.c.GetExportsOfModule(module) {
				candidates[e.Name()] = true
			}
		}
	}
	names := make([]string, 0, len(candidates))
	for name := range candidates {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		symbol := w.c.ResolveName(name, location, ast.SymbolFlagsValue, false)
		if symbol == nil {
			continue
		}
		target := symbol
		if target.Flags()&ast.SymbolFlagsAlias != 0 {
			target = w.c.GetAliasedSymbol(target)
		}
		if target == nil {
			continue
		}
		if path, ok := w.modulePaths[target]; ok {
			w.aliases["prelude#"+name] = path
			continue
		}
		reach, ok := w.reach[target]
		if !ok {
			continue // a JavaScript global, such as Array (D146)
		}
		key := reach[0].key
		home := w.homeOf(target)
		for _, r := range reach {
			if r.module == home {
				key = r.key
				break
			}
		}
		w.aliases["prelude#"+name] = key
	}
}

// pinInputs pins every package the program loaded a file from: its name,
// version, and a digest of all its declaration files (vibelangmapper.
// PackageDigest), so a test can recompute the pin from the package alone.
// vibelang-runtime is pinned by its TypeScript sources.
func pinInputs(p *compiler.Program, runtime string) ([]vibelangmapper.Input, error) {
	roots := map[string]bool{}
	sep := string(filepath.Separator)
	for _, f := range p.SourceFiles() {
		name := filepath.FromSlash(string(f.FileName()))
		if strings.HasPrefix(string(f.FileName()), "bundled:") || !filepath.IsAbs(name) {
			continue
		}
		if strings.HasPrefix(name, runtime+sep) {
			roots[filepath.Dir(runtime)] = true
			continue
		}
		// The package is the directory right under the last node_modules,
		// node_modules/<name> or node_modules/@scope/<name>, whatever
		// package.json files its own subdirectories hold.
		i := strings.LastIndex(name, sep+"node_modules"+sep)
		if i < 0 {
			continue
		}
		rest := strings.Split(name[i+len(sep+"node_modules"+sep):], sep)
		depth := 1
		if strings.HasPrefix(rest[0], "@") {
			depth = 2
		}
		if len(rest) <= depth {
			continue
		}
		roots[name[:i+len(sep+"node_modules"+sep)]+filepath.Join(rest[:depth]...)] = true
	}
	var inputs []vibelangmapper.Input
	for root := range roots {
		data, err := os.ReadFile(filepath.Join(root, "package.json"))
		if err != nil {
			return nil, err
		}
		var manifest struct{ Name, Version string }
		if err := json.Unmarshal(data, &manifest); err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Join(root, "package.json"), err)
		}
		dir, sources := root, false
		if strings.HasPrefix(runtime+string(filepath.Separator), root+string(filepath.Separator)) {
			dir, sources = runtime, true
		}
		files, sum, err := vibelangmapper.PackageDigest(dir, sources)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, vibelangmapper.Input{Package: manifest.Name, Version: manifest.Version, Files: files, SHA256: sum})
	}
	slices.SortFunc(inputs, func(a, b vibelangmapper.Input) int {
		return cmp.Or(strings.Compare(a.Package, b.Package), strings.Compare(a.Version, b.Version), strings.Compare(a.SHA256, b.SHA256))
	})
	return inputs, nil
}
