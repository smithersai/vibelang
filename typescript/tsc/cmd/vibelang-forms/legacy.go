package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const legacyCommand = "cd typescript/tsc && go run ./cmd/vibelang-forms -legacy internal/vibelang/testdata/legacy_sites.txt"

type legacyBlock struct {
	File, Page                  string
	Language                    string
	Number, Line, Offset, Lines int
	Fragment                    bool
}
type legacyProject struct {
	Config string
	Blocks []legacyBlock
	Files  []string // sources without a project config
}

// legacyOracle checks real projects, never the text mapper. Temporary docs
// projects share the snippet checker's dependency links and preceding-block
// imports. Corpus configs and package-local stubs are retained; default paths
// supply the pinned dependencies where a checkout has not been installed.
func legacyOracle(repo, modules string) ([]byte, error) {
	repo, _ = filepath.Abs(repo)
	modules, _ = filepath.Abs(modules)
	temp, err := os.MkdirTemp("", "vibelang-legacy-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(temp)
	cmd := exec.Command("bun", filepath.Join(repo, "docs/tools/legacy-snippets.ts"), temp)
	cmd.Dir = repo
	cmd.Stderr = os.Stderr
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("prepare docs snippets: %w", err)
	}
	var projects []legacyProject
	if err := json.Unmarshal(output, &projects); err != nil {
		return nil, err
	}
	docsBlocks, docsVibe, docsFragments := 0, 0, 0
	for _, p := range projects {
		docsBlocks += len(p.Blocks)
		for _, block := range p.Blocks {
			if block.Language == "vibe" {
				docsVibe++
			}
			if block.Fragment {
				docsFragments++
			}
		}
	}
	corpus, err := legacyCorpus(repo)
	if err != nil {
		return nil, err
	}
	projects = append(corpus, projects...)
	paths := map[string][]string{
		"vibelang-runtime":   {filepath.ToSlash(filepath.Join(repo, "packages/runtime/dist/index.d.ts"))},
		"vibelang-runtime/*": {filepath.ToSlash(filepath.Join(repo, "packages/runtime/dist/*.d.ts"))},
	}
	for _, pkg := range distPackages {
		if err := exportPaths(paths, modules, pkg); err != nil {
			return nil, err
		}
	}
	counts := map[vibelang.LegacyKind]int{}
	caseCounts, exampleCounts, docCounts := map[string]int{}, map[string]int{}, map[string]int{}
	kindCases := map[string]map[string]bool{}
	caseDirs, examples, docs := map[string]bool{}, map[string]bool{}, map[string]bool{}
	scannedCases, scannedExamples := map[string]bool{}, map[string]bool{}
	for _, project := range corpus {
		for _, file := range project.Files {
			rel, _ := filepath.Rel(repo, file)
			parts := strings.Split(filepath.ToSlash(rel), "/")
			if len(parts) > 3 && strings.HasPrefix(filepath.ToSlash(rel), "typescript/vibelang/cases/") {
				scannedCases[parts[3]] = true
			}
			if len(parts) > 1 && parts[0] == "examples" {
				scannedExamples[parts[1]] = true
			}
		}
	}
	type checkedProject struct {
		lines []string
		err   error
	}
	checked := make([]checkedProject, len(projects))
	jobs := make(chan int)
	var workers sync.WaitGroup
	// Independent programs/checkers never share inference state. Bound the
	// census to four live programs; collect by input index and sort the final
	// records, so worker scheduling cannot affect oracle bytes.
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range jobs {
				project := projects[i]
				start := time.Now()
				name, _ := filepath.Rel(repo, project.Config)
				if len(project.Blocks) > 0 {
					name = project.Blocks[0].Page
				}
				if project.Config == "" {
					name, _ = filepath.Rel(repo, filepath.Dir(project.Files[0]))
				}
				fmt.Fprintf(os.Stderr, "legacy: %d/%d %s\n", i+1, len(projects), filepath.ToSlash(name))
				got, err := legacyProjectLines(repo, temp, project, paths)
				if err != nil {
					checked[i].err = fmt.Errorf("%s: %w", project.Config, err)
				}
				checked[i].lines = got
				if elapsed := time.Since(start); elapsed > 5*time.Second {
					fmt.Fprintf(os.Stderr, "legacy: %s took %s (%d records)\n", name, elapsed.Round(time.Millisecond), len(got))
				}
				// Retain strings only after each program; collect discarded checker
				// state periodically even on hosts with a generous heap limit.
				if i%8 == 0 {
					runtime.GC()
				}
			}
		}()
	}
	for i := range projects {
		jobs <- i
	}
	close(jobs)
	workers.Wait()
	var lines []string
	for _, project := range checked {
		if project.err != nil {
			return nil, project.err
		}
		lines = append(lines, project.lines...)
	}
	slices.Sort(lines)
	lines = slices.Compact(lines)
	for _, line := range lines {
		fields := strings.Fields(line)
		kind := fields[1]
		counts[vibelang.LegacyKind(kind)]++
		path := strings.Split(fields[0], ":")[0]
		if strings.HasPrefix(path, "typescript/vibelang/cases/") {
			name := strings.Split(strings.TrimPrefix(path, "typescript/vibelang/cases/"), "/")[0]
			caseDirs[name] = true
			caseCounts[kind]++
			if kindCases[kind] == nil {
				kindCases[kind] = map[string]bool{}
			}
			kindCases[kind][name] = true
		}
		if strings.HasPrefix(path, "examples/") {
			examples[strings.Split(path, "/")[1]] = true
			exampleCounts[kind]++
		}
		if strings.HasPrefix(path, "docs/user/") || strings.HasPrefix(path, "templates/app/AGENTS.md") {
			// A block marker survives line relocation and repeated captions.
			if _, block, ok := strings.Cut(line, " block="); ok {
				docs[block] = true
				docCounts[kind]++
			}
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# generated by %s; do not edit\n", legacyCommand)
	fmt.Fprintf(&b, "# checked projects=%d case-directories=%d examples=%d docs-blocks=%d; affected case-directories=%d examples=%d docs-blocks=%d\n", len(projects), len(scannedCases), len(scannedExamples), docsBlocks, len(caseDirs), len(examples), len(docs))
	fmt.Fprintf(&b, "# docs languages: vibe=%d ts=%d explicit-fragments=%d (includes onboarding inline checks and templates/app/AGENTS.md)\n", docsVibe, docsBlocks-docsVibe, docsFragments)
	var kinds []string
	for kind := range counts {
		kinds = append(kinds, string(kind))
	}
	slices.Sort(kinds)
	for _, kind := range kinds {
		fmt.Fprintf(&b, "# %s=%d cases=%d case-directories=%d examples=%d docs=%d\n", kind, counts[vibelang.LegacyKind(kind)], caseCounts[kind], len(kindCases[kind]), exampleCounts[kind], docCounts[kind])
	}
	for _, line := range lines {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return []byte(b.String()), nil
}

func legacyCorpus(repo string) ([]legacyProject, error) {
	roots := append(slices.Clone(decisionRoots), "packages")
	groups := map[string]*legacyProject{}
	for _, root := range roots {
		err := filepath.WalkDir(filepath.Join(repo, root), func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() && (d.Name() == "node_modules" || d.Name() == "out" || d.Name() == "dist" || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			if d.IsDir() || !strings.HasSuffix(path, ".vibe") {
				return nil
			}
			if root == "packages" && !strings.Contains(filepath.ToSlash(path), "/test/") {
				return nil
			}
			dir := filepath.Dir(path)
			config := ""
			for at := dir; strings.HasPrefix(at, repo+string(filepath.Separator)); at = filepath.Dir(at) {
				if _, err := os.Stat(filepath.Join(at, "tsconfig.json")); err == nil {
					config = filepath.Join(at, "tsconfig.json")
					break
				}
			}
			key := config
			if key == "" {
				key = dir
			}
			if groups[key] == nil {
				groups[key] = &legacyProject{Config: config}
			}
			groups[key].Files = append(groups[key].Files, path)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	var keys []string
	for key := range groups {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	var result []legacyProject
	for _, key := range keys {
		result = append(result, *groups[key])
	}
	return result, nil
}

func legacyProjectLines(repo, temp string, project legacyProject, defaults map[string][]string) ([]string, error) {
	fs := bundled.WrapFS(osvfs.FS())
	config := project.Config
	if config == "" {
		dir := filepath.Dir(project.Files[0])
		config = filepath.Join(dir, "$legacy-tsconfig.json")
		data, _ := json.Marshal(map[string]any{"compilerOptions": map[string]any{
			"strict": true, "target": "esnext", "module": "nodenext", "skipLibCheck": true, "types": []string{},
		}, "files": project.Files})
		base := fs
		fs = wrapvfs.Wrap(base, wrapvfs.Replacements{
			FileExists: func(path tspath.RootedFilePath) bool {
				return string(path) == filepath.ToSlash(config) || base.FileExists(path)
			},
			ReadFile: func(path tspath.RootedFilePath) (string, bool) {
				if string(path) == filepath.ToSlash(config) {
					return string(data), true
				}
				return base.ReadFile(path)
			},
		})
	}
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
	if parsed == nil || len(errors) > 0 {
		return nil, fmt.Errorf("cannot load project: %v", errors)
	}
	// Some package fixtures live outside their package's normal include list.
	// Include every discovered .vibe file, while retaining TS companions.
	files := slices.Clone(parsed.ParsedConfig.FileNames)
	for _, file := range project.Files {
		files = append(files, tspath.RootedFilePathFromAbsolute(filepath.ToSlash(file)))
	}
	slices.Sort(files)
	parsed = parsed.WithFileNames(slices.Compact(files))
	opts := parsed.CompilerOptions()
	opts.NoEmit, opts.SkipLibCheck = core.TSTrue, core.TSTrue
	if opts.Paths == nil {
		opts.Paths = &collections.OrderedMap[string, []string]{}
	}
	var keys []string
	for key := range defaults {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		if _, exists := opts.Paths.Get(key); !exists {
			opts.Paths.Set(key, defaults[key])
		}
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), SingleThreaded: core.TSTrue})
	c, done := p.GetTypeChecker(context.Background())
	defer done()
	var sources []*ast.SourceFile
	for _, file := range p.SourceFiles() {
		name := string(file.FileName())
		if strings.HasSuffix(name, ".vibe") && !strings.Contains(name, "/node_modules/") {
			sources = append(sources, file)
		}
	}
	// Check every included declaration before observing any final conversions.
	for _, file := range sources {
		c.GetDiagnostics(context.Background(), file)
	}
	blocks := map[string]legacyBlock{}
	for _, block := range project.Blocks {
		blocks[filepath.ToSlash(block.File)] = block
	}
	location := func(file *ast.SourceFile, pos int) string {
		name := string(file.FileName())
		line, col := legacyLineColumn(file.Text(), pos)
		if block, ok := blocks[name]; ok {
			return fmt.Sprintf("%s:%d:%d", block.Page, block.Line+line-block.Offset-1, col)
		}
		if rel, err := filepath.Rel(repo, name); err == nil && !strings.HasPrefix(rel, "..") {
			name = filepath.ToSlash(rel)
		}
		return fmt.Sprintf("%s:%d:%d", name, line, col)
	}
	signature := func(sig *checker.Signature) string {
		if sig == nil {
			return "none"
		}
		if decl := sig.Declaration(); decl != nil {
			file := ast.GetSourceFileOfNode(decl)
			return location(file, scanner.SkipTrivia(file.Text(), decl.Pos()))
		}
		return "synthetic"
	}
	var lines []string
	for _, file := range sources {
		for _, site := range vibelang.LegacySites(c, file) {
			if block, ok := blocks[string(file.FileName())]; ok {
				line, _ := legacyLineColumn(file.Text(), site.Span.Pos())
				if line <= block.Offset || line > block.Offset+block.Lines {
					continue
				}
			}
			text := ""
			if site.Signature != nil {
				text = c.SignatureToStringEx(site.Signature, site.Node, checker.TypeFormatFlagsNone, nil)
			}
			text = strings.ReplaceAll(strings.ReplaceAll(text, filepath.ToSlash(repo)+"/", ""), filepath.ToSlash(temp)+"/", "$docs/")
			line := fmt.Sprintf("%s %s length=%d boundary=%s representation=%s selected=%t signature=%q type=%q", location(file, site.Span.Pos()), site.Kind,
				site.Span.End()-site.Span.Pos(), site.Boundary, site.Representation, site.Selected, signature(site.Signature), text)
			if site.Uncertainty != "" {
				line += fmt.Sprintf(" uncertainty=%q", site.Uncertainty)
			}
			if len(site.ReturnedPrograms) > 0 {
				var returns []string
				for _, result := range site.ReturnedPrograms {
					returns = append(returns, location(file, scanner.SkipTrivia(file.Text(), result.Pos())))
				}
				line += fmt.Sprintf(" returns=%q", strings.Join(returns, ","))
			}
			var candidates []string
			for _, candidate := range site.Candidates {
				candidates = append(candidates, signature(candidate))
			}
			slices.Sort(candidates)
			if len(candidates) > 0 {
				line += fmt.Sprintf(" candidates=%q", strings.Join(slices.Compact(candidates), ","))
			}
			if block, ok := blocks[string(file.FileName())]; ok {
				line += fmt.Sprintf(" block=%s#%d", block.Page, block.Number)
			}
			lines = append(lines, line)
		}
	}
	return lines, nil
}

func legacyLineColumn(text string, pos int) (line, column int) {
	line, column = 1, 1
	for _, c := range text[:pos] {
		if c == '\n' {
			line, column = line+1, 1
		} else {
			column++
		}
	}
	return
}
