package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/binder"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The invariants of a compilation's outputs, which hold when the
// compilation reports no error.

func isJS(name string) bool {
	return strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs") || strings.HasSuffix(name, ".cjs") || strings.HasSuffix(name, ".jsx")
}

func isDeclaration(name string) bool {
	return strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.mts") || strings.HasSuffix(name, ".d.cts")
}

// fromVibe reports whether a program file is, or belongs to, a .vibe source:
// a module declaration's body is a file of its own whose original file is
// the .vibe file (D283, D403).
func fromVibe(file *ast.SourceFile) bool {
	return file != nil && strings.HasSuffix(string(file.OriginalFileName()), ".vibe")
}

// relName returns a program file's path relative to the project directory.
func relName(dir string, file *ast.SourceFile) string {
	return strings.TrimPrefix(string(file.OriginalFileName()), filepath.ToSlash(dir)+"/")
}

// ParseJS parses emitted JavaScript and returns its syntax errors: the
// parser's, the ones it reports for TypeScript syntax in a JavaScript file,
// and the binder's early errors, such as a strict-mode violation.
func ParseJS(name, text string) (*ast.SourceFile, []*ast.Diagnostic) {
	kind := core.ScriptKindJS
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/emitted/" + name), PathKey: tspath.PathKey("/emitted/" + name)}, text, kind)
	ds := slices.Concat(file.Diagnostics(), file.JSDiagnostics())
	if len(ds) == 0 {
		binder.BindSourceFile(file)
		ds = append(ds, file.BindDiagnostics()...)
	}
	return file, ds
}

// ParseDeclaration parses an emitted declaration file and returns its syntax
// errors.
func ParseDeclaration(name, text string) []*ast.Diagnostic {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/emitted/" + name), PathKey: tspath.PathKey("/emitted/" + name)}, text, core.ScriptKindTS)
	return slices.Concat(file.Diagnostics(), file.JSDiagnostics())
}

// A ModuleUse is a module specifier an emitted file names, with the bindings
// of an import that gives its module a local name.
type ModuleUse struct {
	Specifier string
	Literal   bool // a string literal, not a template
	// Named are the export names a named import or re-export reads.
	Named []string
	// Namespace is the local name of a namespace import, or of a CommonJS
	// require bound to a variable.
	Namespace string
}

// ModuleUses returns every module an emitted file imports, re-exports,
// requires or loads with a literal dynamic import, and every import type.
func ModuleUses(file *ast.SourceFile) []ModuleUse {
	var uses []ModuleUse
	literal := func(n *ast.Node) (string, bool, bool) {
		if n == nil {
			return "", false, false
		}
		if ast.IsLiteralTypeNode(n) {
			n = n.AsLiteralTypeNode().Literal
		}
		if ast.IsStringLiteral(n) {
			return n.Text(), true, true
		}
		if ast.IsStringLiteralLike(n) {
			return n.Text(), false, true
		}
		return "", false, false
	}
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		switch {
		case ast.IsImportDeclaration(n):
			decl := n.AsImportDeclaration()
			if s, lit, ok := literal(decl.ModuleSpecifier); ok {
				use := ModuleUse{Specifier: s, Literal: lit}
				if clause := decl.ImportClause; clause != nil && !clause.IsTypeOnly() {
					if clause.Name() != nil {
						use.Named = append(use.Named, "default")
					}
					if bindings := clause.AsImportClause().NamedBindings; bindings != nil {
						if ast.IsNamespaceImport(bindings) {
							use.Namespace = bindings.Name().Text()
						} else {
							for _, element := range bindings.AsNamedImports().Elements.Nodes {
								specifier := element.AsImportSpecifier()
								if specifier.IsTypeOnly {
									continue
								}
								name := element.Name()
								if specifier.PropertyName != nil {
									name = specifier.PropertyName
								}
								use.Named = append(use.Named, name.Text())
							}
						}
					}
				}
				uses = append(uses, use)
			}
		case ast.IsExportDeclaration(n):
			decl := n.AsExportDeclaration()
			if s, lit, ok := literal(decl.ModuleSpecifier); ok {
				use := ModuleUse{Specifier: s, Literal: lit}
				if clause := decl.ExportClause; clause != nil && !decl.IsTypeOnly && ast.IsNamedExports(clause) {
					for _, element := range clause.AsNamedExports().Elements.Nodes {
						specifier := element.AsExportSpecifier()
						if specifier.IsTypeOnly {
							continue
						}
						name := element.Name()
						if specifier.PropertyName != nil {
							name = specifier.PropertyName
						}
						use.Named = append(use.Named, name.Text())
					}
				}
				uses = append(uses, use)
			}
		case ast.IsImportEqualsDeclaration(n):
			if reference := n.AsImportEqualsDeclaration().ModuleReference; reference != nil && ast.IsExternalModuleReference(reference) {
				if s, lit, ok := literal(reference.AsExternalModuleReference().Expression); ok {
					uses = append(uses, ModuleUse{Specifier: s, Literal: lit, Namespace: n.Name().Text()})
				}
			}
		case ast.IsImportCall(n), ast.IsRequireCall(n, true):
			if args := n.Arguments(); len(args) > 0 {
				if s, lit, ok := literal(args[0]); ok {
					use := ModuleUse{Specifier: s, Literal: lit}
					// A CommonJS binding: const runtime = require("…"), or one
					// TypeScript wraps, __importStar(require("…")).
					for p := n.Parent; p != nil; p = p.Parent {
						if ast.IsVariableDeclaration(p) && ast.IsIdentifier(p.Name()) {
							use.Namespace = p.Name().Text()
							break
						}
						if !ast.IsCallExpression(p) && !ast.IsParenthesizedExpression(p) {
							break
						}
					}
					uses = append(uses, use)
				}
			}
		case ast.IsImportTypeNode(n):
			if s, lit, ok := literal(n.AsImportTypeNode().Argument); ok {
				uses = append(uses, ModuleUse{Specifier: s, Literal: lit})
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	for _, supplemental := range file.SupplementalSourceFiles() {
		uses = append(uses, ModuleUses(supplemental)...)
	}
	return uses
}

// memberReads returns the names read as members of a binding, binding.name
// or binding["name"], and whether the file declares the name anywhere else,
// in which case the reads may belong to another binding.
func memberReads(file *ast.SourceFile, binding string) (names []string, shadowed bool) {
	declarations := 0
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		if ast.IsDeclaration(n) && n.Name() != nil && ast.IsIdentifier(n.Name()) && n.Name().Text() == binding {
			declarations++
		}
		var object, member *ast.Node
		switch {
		case ast.IsPropertyAccessExpression(n):
			object, member = n.Expression(), n.Name()
		case ast.IsElementAccessExpression(n) && ast.IsStringLiteral(n.AsElementAccessExpression().ArgumentExpression):
			object, member = n.Expression(), n.AsElementAccessExpression().ArgumentExpression
		}
		if object != nil && ast.IsIdentifier(object) && object.Text() == binding && !slices.Contains(names, member.Text()) {
			names = append(names, member.Text())
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	return names, declarations > 1
}

// sourceSpecifiers returns only modules the source actually names in an
// import, re-export, import type, or literal dynamic import/require (D30,
// D31, D365). Ordinary strings and comments cannot authorize an import.
func sourceSpecifiers(name, text string) map[string]bool {
	kind := core.ScriptKindTS
	if strings.HasSuffix(name, ".tsx") {
		kind = core.ScriptKindTSX
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/source/" + name), PathKey: tspath.PathKey("/source/" + name)}, text, kind)
	specifiers := map[string]bool{}
	for _, use := range ModuleUses(file) {
		specifiers[use.Specifier] = true
	}
	return specifiers
}

// sourceExtensions maps an output's extension to the source extensions it
// is emitted from: D31, D63 and D365 write a relative specifier of a .vibe
// or .ts source with the output's .js name, and TypeScript writes .mts and
// .cts sources as .mjs and .cjs.
var sourceExtensions = map[string][]string{
	".js":  {".vibe", ".ts", ".tsx", ".jsx", ".js"},
	".mjs": {".mts", ".mjs"},
	".cjs": {".cts", ".cjs"},
}

// specifierWritten reports whether a .vibe source wrote an emitted
// specifier, with its extension rewritten (D31, D365) and the path spelled as
// an ES module import reads it, an escaped URL.
func specifierWritten(specifier string, specifiers map[string]bool) bool {
	candidates := []string{specifier}
	if unescaped, err := url.PathUnescape(specifier); err == nil && unescaped != specifier {
		candidates = append(candidates, unescaped)
	}
	for _, s := range candidates {
		if specifiers[s] {
			return true
		}
		extension := path.Ext(s)
		for _, from := range sourceExtensions[extension] {
			if specifiers[strings.TrimSuffix(s, extension)+from] {
				return true
			}
		}
	}
	return false
}

func isPackage(specifier, name string) bool {
	return specifier == name || strings.HasPrefix(specifier, name+"/")
}

func isRelative(specifier string) bool {
	return strings.HasPrefix(specifier, "./") || strings.HasPrefix(specifier, "../")
}

var platformImport = regexp.MustCompile(`^vibelang/platform(/|$)`)

// OutputChecker checks a compilation's outputs.
type OutputChecker struct {
	W    *Workspace
	G    *Gaps
	Ctx  context.Context
	Logf func(string, ...any)
}

// Check applies every output invariant to a compilation that reported no
// error.
func (oc *OutputChecker) Check(c *Compilation) {
	options := c.Program.Options()
	// Chapter 27's pipeline emits every project source. TypeScript options
	// retain their meanings (Chapter 28): noEmit and emitDeclarationOnly are
	// explicit exceptions, and sourceMap/declaration request actual outputs.
	if c.EmitSkipped && !options.NoEmit.IsTrue() {
		oc.G.Add("feature:emit-skipped", "Chapter 27 (D34): a program without errors skipped requested emit")
	}
	for _, file := range c.Program.SourceFiles() {
		name := string(file.FileName())
		if file.IsDeclarationFile || file.CanonicalSourceFile() != nil || c.Program.IsSourceFileFromExternalLibrary(file) || !strings.HasPrefix(name, filepath.ToSlash(c.Dir)+"/") || !isSource(name) {
			continue
		}
		required := map[string]bool{
			"js":          !options.NoEmit.IsTrue() && !options.EmitDeclarationOnly.IsTrue(),
			"declaration": !options.NoEmit.IsTrue() && (options.Declaration.IsTrue() || options.Composite.IsTrue() || options.EmitDeclarationOnly.IsTrue()),
			"source-map":  !options.NoEmit.IsTrue() && !options.EmitDeclarationOnly.IsTrue() && options.SourceMap.IsTrue(),
		}
		for output := range c.Outputs {
			if c.From[output] == nil || c.From[output].OriginalFileName() != file.OriginalFileName() {
				continue
			}
			if isJS(output) {
				required["js"] = false
			}
			if isDeclaration(output) {
				required["declaration"] = false
			}
			if strings.HasSuffix(output, ".map") && isJS(strings.TrimSuffix(output, ".map")) {
				required["source-map"] = false
			}
		}
		for _, output := range mapKeys(required) {
			if required[output] {
				oc.G.Add("feature:missing-"+output, "Chapter 27 (D34): %s compiled without errors but has no requested %s output (outputs: %v)", relName(c.Dir, file), output, mapKeys(c.Outputs))
			}
		}
	}
	var declarations []string
	for _, name := range mapKeys(c.Outputs) {
		text := c.Outputs[name]
		from := c.From[name]
		switch {
		case strings.HasSuffix(name, ".map"):
			oc.checkSourceMap(c, name, text)
		case isJS(name) && fromVibe(from):
			oc.checkJS(c, name, text, from)
		case isDeclaration(name) && fromVibe(from):
			oc.checkDeclarationText(c, name, text, from)
			declarations = append(declarations, name)
		}
	}
	if len(declarations) != 0 && !oc.G.Any() {
		oc.checkConsumer(c, declarations)
	}
}

func mapKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func (oc *OutputChecker) checkJS(c *Compilation, name, text string, from *ast.SourceFile) {
	file, errors := ParseJS(name, text)
	// Chapter 27: the lowering's output is JavaScript that TypeScript's
	// emitter prints; it parses, and Node loads it (D30).
	if len(errors) != 0 {
		d := errors[0]
		oc.G.Add("feature:js-syntax", "Chapter 27: %s, emitted from %s, does not parse: %s at %d: …%q…", name, relName(c.Dir, from), d.String(), d.Pos(), excerpt(text, d.Pos()))
		return
	}
	source := from.OriginalText()
	specifiers := sourceSpecifiers(relName(c.Dir, from), source)
	entry := strings.Contains(text, "$entry(")
	options := c.Program.Options()
	for _, use := range ModuleUses(file) {
		s := use.Specifier
		// D312: "The import loads nothing: the compiler removes it from the
		// JavaScript and the declarations."
		if platformImport.MatchString(s) {
			oc.G.Add("feature:d312-platform-import", "D312: %s still imports %q", name, s)
			continue
		}
		// D365 (Chapter 26, Modules rule 5): a relative specifier naming a
		// .vibe or .ts source is written with the output's .js name, in every
		// import form whose specifier is a string literal.
		if use.Literal && isRelative(s) && hasSourceExtension(s) {
			oc.G.Add("feature:d365-js", "D365: %s imports %q, a source name, not its output", name, s)
			continue
		}
		allowed := isPackage(s, "effect") || isPackage(s, "vibelang-runtime") || // Chapter 27, D30
			specifierWritten(s, specifiers) || // the source's own import, D31, D365
			entry && (isPackage(s, "@effect/platform-node") || isPackage(s, "@effect/platform-bun") || isPackage(s, "@effect/platform-browser")) || // D135, D312
			options.ImportHelpers.IsTrue() && isPackage(s, "tslib") // TypeScript's own option keeps its meaning (Chapter 28)
		if !allowed {
			oc.G.Add("feature:js-imports", "Chapter 27 (D30): %s imports %q, which is neither effect, vibelang-runtime, nor a specifier %s wrote", name, s, relName(c.Dir, from))
			continue
		}
		// Chapter 27's runtime boundary: the helpers the compiler emits are
		// the runtime's exports. A subpath the source imports itself was
		// checked as the source, and a project may map it elsewhere.
		if s == "vibelang-runtime" || isPackage(s, "vibelang-runtime") && !specifierWritten(s, specifiers) {
			names := slices.Clone(use.Named)
			if use.Namespace != "" {
				reads, shadowed := memberReads(file, use.Namespace)
				if !shadowed {
					names = append(names, reads...)
				}
			}
			exports, err := oc.W.ModuleExports(oc.Ctx, s)
			if err != nil {
				oc.G.Add("feature:runtime-helper", "Chapter 27: cannot read the exports of %q: %v", s, err)
				continue
			}
			for _, n := range names {
				if !exports[n] {
					oc.G.Add("feature:runtime-helper", "Chapter 27: %s reads %q from %q, which the runtime does not export", name, n, s)
				}
			}
		}
	}
}

func hasSourceExtension(specifier string) bool {
	if strings.HasSuffix(specifier, ".d.ts") {
		return false
	}
	for _, extension := range []string{".vibe", ".ts", ".tsx", ".mts", ".cts"} {
		if strings.HasSuffix(specifier, extension) {
			return true
		}
	}
	return false
}

func excerpt(text string, pos int) string {
	pos = max(0, min(pos, len(text)))
	return text[max(0, pos-60):min(len(text), pos+60)]
}

func (oc *OutputChecker) checkDeclarationText(c *Compilation, name, text string, from *ast.SourceFile) {
	// Chapter 27, Declarations and the ABI, rule 4: "A declaration file is
	// TypeScript that stock TypeScript checks"; it parses as one.
	if errors := ParseDeclaration(name, text); len(errors) != 0 {
		d := errors[0]
		oc.G.Add("feature:declaration-parse", "Chapter 27 rule 4: %s does not parse as a declaration file: %s at %d: …%q…", name, d.String(), d.Pos(), excerpt(text, d.Pos()))
		return
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/emitted/" + name), PathKey: tspath.PathKey("/emitted/" + name)}, text, core.ScriptKindTS)
	for _, use := range ModuleUses(file) {
		if platformImport.MatchString(use.Specifier) {
			oc.G.Add("feature:d312-platform-import", "D312: %s still imports %q", name, use.Specifier)
		}
		// D365 and D298: declarations name a VibeLang module through its
		// .js output; no TypeScript resolves ./x.vibe to x.d.ts.
		if isRelative(use.Specifier) && hasSourceExtension(use.Specifier) {
			oc.G.Add("feature:d365-declaration", "D365: %s names %q, a source name, not its output", name, use.Specifier)
		}
	}
	// Detail 72: an augmentation names its module the same way. ./x.vibe has
	// no declaration beside the output, so the augmentation would be lost.
	for _, statement := range file.Statements.Nodes {
		if ast.IsModuleDeclaration(statement) && ast.IsStringLiteral(statement.Name()) && isRelative(statement.Name().Text()) && strings.HasSuffix(statement.Name().Text(), ".vibe") {
			oc.G.Add("feature:declaration-augmentation-name", "detail 72: %s augments %q, a source name, not its output", name, statement.Name().Text())
		}
	}
}

// A SourceMap is a version 3 source map.
type SourceMap struct {
	Version    int      `json:"version"`
	File       string   `json:"file"`
	SourceRoot string   `json:"sourceRoot"`
	Sources    []string `json:"sources"`
	Names      []string `json:"names"`
	Mappings   string   `json:"mappings"`
}

func (oc *OutputChecker) checkSourceMap(c *Compilation, name, text string) {
	generatedName := strings.TrimSuffix(name, ".map")
	generated, ok := c.Outputs[generatedName]
	from := c.From[name]
	if from == nil {
		from = c.From[generatedName]
	}
	if !ok || !fromVibe(from) {
		return
	}
	// Chapter 28, Debugging (D34): "Each map carries original .vibe
	// positions"; a debugger reads it as a standard (version 3) source map.
	var m SourceMap
	if err := json.Unmarshal([]byte(text), &m); err != nil || m.Version != 3 {
		oc.G.Add("feature:source-map", "D34: %s is not a version 3 source map (%v): %.200q", name, err, text)
		return
	}
	dir := path.Dir(name)
	if m.SourceRoot != "" {
		if path.IsAbs(m.SourceRoot) || strings.Contains(m.SourceRoot, ":") {
			return // a configured absolute root names no project file
		}
		dir = path.Join(dir, m.SourceRoot)
	}
	vibe := relName(c.Dir, from)
	var texts []string
	named := false
	vibeIndex := -1
	for index, source := range m.Sources {
		resolved := path.Clean(path.Join(dir, source))
		if resolved == vibe {
			named = true
			vibeIndex = index
		}
		text, ok := c.Sources[resolved]
		if !ok {
			text = "\x00unknown"
		}
		texts = append(texts, text)
	}
	if !named {
		oc.G.Add("feature:source-map", "D34: %s maps %s, emitted from %s, to %q, not to the .vibe file", name, generatedName, vibe, m.Sources)
		return
	}
	generatedLines := UTF16Lines(generated)
	sourceLines := make([][]int, len(texts))
	decoder := sourcemap.DecodeMappings(m.Mappings)
	for mapping := range decoder.Values() {
		if mapping.GeneratedLine >= len(generatedLines) || int(mapping.GeneratedCharacter) > generatedLines[mapping.GeneratedLine] {
			oc.G.Add("feature:source-map-range:generated", "D34: %s has a segment at generated %d:%d, outside %s", name, mapping.GeneratedLine, mapping.GeneratedCharacter, generatedName)
			return
		}
		if mapping.NameIndex != sourcemap.MissingName && int(mapping.NameIndex) >= len(m.Names) {
			oc.G.Add("feature:source-map", "D34: %s has a segment naming name %d of %d", name, mapping.NameIndex, len(m.Names))
			return
		}
		if !mapping.IsSourceMapping() {
			continue
		}
		index := int(mapping.SourceIndex)
		if index < 0 || index >= len(texts) {
			oc.G.Add("feature:source-map", "D34: %s has a segment naming source %d of %d", name, index, len(texts))
			return
		}
		if texts[index] == "\x00unknown" {
			continue
		}
		if sourceLines[index] == nil {
			sourceLines[index] = UTF16Lines(texts[index])
		}
		lines := sourceLines[index]
		if mapping.SourceLine >= len(lines) || int(mapping.SourceCharacter) > lines[mapping.SourceLine] {
			// The key says where the segment falls, so that one known gap, a
			// segment one character past the end of the text, does not skip
			// every other.
			where := "source"
			if mapping.SourceLine == len(lines)-1 && int(mapping.SourceCharacter) == lines[mapping.SourceLine]+1 {
				where = "one-past-end"
			}
			oc.G.Add("feature:source-map-range:"+where, "D34: %s has a segment at %s %d:%d, outside the source text (%d lines)", name, m.Sources[index], mapping.SourceLine, mapping.SourceCharacter, len(lines))
			return
		}
	}
	if err := decoder.Error(); err != nil {
		oc.G.Add("feature:source-map", "D34: %s's mappings do not decode: %v", name, err)
		return
	}
	oc.checkStatementMappings(generatedName, generated, texts[vibeIndex], vibeIndex, m)
}

// checkConsumer compiles a TypeScript consumer of the emitted declarations
// alone, as Chapter 27 rule 4 says stock TypeScript checks them: with
// skipLibCheck off for the declarations, against the installed effect and
// runtime packages. The consumer lives in a mirror of the outputs, so that
// no import of it can resolve to a .vibe source.
func (oc *OutputChecker) checkConsumer(c *Compilation, declarations []string) {
	mirror := "__declarations"
	files := map[string]string{}
	for name, text := range c.Outputs {
		if isDeclaration(name) || strings.HasSuffix(name, ".json") {
			files[name] = text
		}
	}
	var inputs []string
	for name, text := range c.Sources {
		if isDeclaration(name) || path.Base(name) == "package.json" {
			if _, emitted := files[name]; !emitted {
				files[name] = text
			}
			if isDeclaration(name) {
				inputs = append(inputs, name)
			}
		}
	}
	var consumer strings.Builder
	for i, name := range declarations {
		specifier := "./" + name
		for from, to := range map[string]string{".d.ts": ".js", ".d.mts": ".mjs", ".d.cts": ".cjs"} {
			if strings.HasSuffix(specifier, from) {
				specifier = strings.TrimSuffix(specifier, from) + to
				break
			}
		}
		fmt.Fprintf(&consumer, "import * as m%d from %q\nexport type T%d = typeof m%d\n", i, specifier, i, i)
	}
	files["__consumer.mts"] = consumer.String()
	listed, _ := json.Marshal(append([]string{"__consumer.mts"}, inputs...))
	config := `{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "skipLibCheck": false,
    "composite": false,
    "incremental": false,
    "declaration": false,
    "declarationMap": false,
    "emitDeclarationOnly": false
  },
  "files": ` + string(listed) + `,
  "include": []
}`
	for name, text := range files {
		if err := writeInside(filepath.Join(c.Dir, mirror), name, text); err != nil {
			oc.G.Add("feature:declaration-consumer", "cannot write declaration mirror: %v", err)
			return
		}
	}
	if err := os.WriteFile(filepath.Join(c.Dir, mirror, "tsconfig.json"), []byte(config), 0o600); err != nil {
		oc.G.Add("feature:declaration-consumer", "cannot write consumer config: %v", err)
		return
	}
	probe, err := oc.W.compileDir(oc.Ctx, filepath.Join(c.Dir, mirror))
	if err != nil || probe.Program == nil {
		oc.G.Add("feature:declaration-consumer", "Chapter 27 rule 4: cannot load declaration exports: %v", err)
		return
	}
	typeChecker, done := probe.Program.GetTypeChecker(oc.Ctx)
	for i, name := range declarations {
		file := probe.SourceFile(name)
		if file == nil {
			continue
		}
		consumerFile := probe.SourceFile("__consumer.mts")
		namespace := consumerFile.Statements.Nodes[2*i].AsImportDeclaration().ImportClause.AsImportClause().NamedBindings.Name()
		namespaceType := typeChecker.GetTypeAtLocation(namespace)
		exports := typeChecker.GetPropertiesOfType(namespaceType)
		slices.SortFunc(exports, func(a, b *ast.Symbol) int { return strings.Compare(a.Name(), b.Name()) })
		for j, symbol := range exports {
			if typeChecker.SkipAlias(symbol).Flags()&ast.SymbolFlagsValue == 0 {
				continue
			}
			signatures := typeChecker.GetSignaturesOfType(typeChecker.GetTypeOfSymbolAtLocation(symbol, file.AsNode()), checker.SignatureKindCall)
			if len(signatures) == 0 {
				continue
			}
			// Chapter 27 rules 1 and 4 (D366): call every callable export with
			// its declaration's parameter tuple and assign its declared result.
			// Utility types keep private names, generics, optional/rest parameters
			// and aliases in the declaration's own scope. For overloads they select
			// the last public signature, which is itself a valid call contract.
			callee := fmt.Sprintf("m%d[%q]", i, symbol.Name())
			fmt.Fprintf(&consumer, "declare const args%d_%d: Parameters<typeof %s>\n", i, j, callee)
			call := fmt.Sprintf("%s(...args%d_%d)", callee, i, j)
			if signatures[len(signatures)-1].ThisParameter() != nil {
				fmt.Fprintf(&consumer, "declare const this%d_%d: ThisParameterType<typeof %s>\n", i, j, callee)
				call = fmt.Sprintf("%s.call(this%d_%d, ...args%d_%d)", callee, i, j, i, j)
			}
			fmt.Fprintf(&consumer, "export const result%d_%d: ReturnType<typeof %s> = %s\n", i, j, callee, call)
		}
	}
	done()
	if err := writeInside(filepath.Join(c.Dir, mirror), "__consumer.mts", consumer.String()); err != nil {
		oc.G.Add("feature:declaration-consumer", "Chapter 27 rule 4: cannot write consumer: %v", err)
		return
	}
	// The native fork and stock TypeScript check the same isolated consumer.
	// An unavailable stock compiler skips only that half, with a reason.
	oc.checkStockConsumer(filepath.Join(c.Dir, mirror), inputs)
	consumerResult, err := oc.W.checkFiles(oc.Ctx, filepath.Join(c.Dir, mirror), append([]string{"__consumer.mts"}, declarations...))
	if err != nil {
		oc.G.Add("feature:declaration-consumer", "Chapter 27 rule 4: the consumer did not compile: %v", err)
		return
	}
	for _, d := range consumerResult {
		if d.Category() == diagnostics.CategoryError {
			text := ""
			if d.File() != nil {
				text = excerpt(d.File().Text(), d.Pos())
			}
			oc.G.Add(fmt.Sprintf("feature:declaration-consumer-TS%d", d.Code()), "Chapter 27 rule 4 (D366): a TypeScript consumer of the emitted declarations does not type-check: %s near %q", keyOf(c.Dir, d), text)
			return
		}
	}
}

// exportsCache holds each workspace's runtime exports by specifier.
var exportsCache sync.Map // string -> func() (map[string]bool, error)

// ModuleExports returns the actual ESM value exports of the installed runtime
// (Chapter 27, D30). Reading declarations here would allow a helper missing
// from executable JavaScript to pass. Node imports once per workspace/module.
func (w *Workspace) ModuleExports(ctx context.Context, specifier string) (map[string]bool, error) {
	key := w.Dir + "\x00" + specifier
	probe, _ := exportsCache.LoadOrStore(key, sync.OnceValues(func() (map[string]bool, error) {
		cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", `const m = await import(process.argv[1]); console.log(JSON.stringify(Object.keys(m)));`, specifier)
		cmd.Dir = w.Dir
		output, err := cmd.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("import executable %q: %w: %.600s", specifier, err, output)
		}
		var names []string
		if err := json.Unmarshal(output, &names); err != nil {
			return nil, fmt.Errorf("executable exports of %q: %w", specifier, err)
		}
		exports := map[string]bool{}
		for _, name := range names {
			exports[name] = true
		}
		return exports, nil
	}))
	return probe.(func() (map[string]bool, error))()
}

// checkFiles compiles the project whose tsconfig.json is in dir without
// emitting, and returns its configuration, syntactic and global diagnostics
// and the semantic diagnostics of the named files.
func (w *Workspace) checkFiles(ctx context.Context, dir string, names []string) ([]*ast.Diagnostic, error) {
	c, err := w.compileDir(ctx, dir)
	if err != nil || c.Program == nil {
		return c.Diagnostics, err
	}
	ds := c.Diagnostics
	ds = append(ds, c.Program.GetConfigFileParsingDiagnostics()...)
	ds = append(ds, c.Program.GetSyntacticDiagnostics(ctx, nil)...)
	ds = append(ds, c.Program.GetProgramDiagnostics()...)
	ds = append(ds, c.Program.GetGlobalDiagnostics(ctx)...)
	for _, name := range names {
		file := c.Program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, filepath.FromSlash(name)))))
		if file == nil {
			ds = append(ds, ast.NewExternalDiagnostic(nil, core.TextRange{}, "", diagnostics.CategoryError, 0, name+" is not in the consumer's program"))
			continue
		}
		ds = append(ds, c.Program.GetSemanticDiagnostics(ctx, file)...)
	}
	return ds, nil
}
