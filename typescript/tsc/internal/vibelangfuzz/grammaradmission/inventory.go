// Package grammaradmission is the census of VibeLang's parser and lowering hooks
// and the check of its inventory table. It imports only the standard library, so
// its test compiles in seconds and the merge queue's build-only gate can run it,
// where the fuzz package takes minutes to build.
package grammaradmission

import (
	"fmt"
	goast "go/ast"
	goparser "go/parser"
	gotoken "go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const appendix = "900-appendices.md"

// Table is the inventory's path under the repository root.
const Table = "typescript/tsc/internal/vibelangfuzz/testdata/grammar_admission.tsv"

// Hooks is deliberately a source census, not a list of today's passing
// programs. Even recovery and implementation helpers must be accounted for.
// The table does not grant authority to denied, open or legacy forms.
func Hooks(root string) (map[string]bool, error) {
	hooks := map[string]bool{}
	for _, dir := range []string{"parser", "vibelang"} {
		files, err := filepath.Glob(filepath.Join(root, "typescript/tsc/internal", dir, "*.go"))
		if err != nil {
			return nil, err
		}
		for _, file := range files {
			base := filepath.Base(file)
			if strings.HasSuffix(base, "_test.go") {
				continue
			}
			tree, err := goparser.ParseFile(gotoken.NewFileSet(), file, nil, 0)
			if err != nil {
				return nil, err
			}
			loweringFile := false
			for _, decl := range tree.Decls {
				if fn, ok := decl.(*goast.FuncDecl); ok && fn.Recv != nil {
					typ := fn.Recv.List[0].Type
					if ptr, ok := typ.(*goast.StarExpr); ok {
						typ = ptr.X
					}
					if id, ok := typ.(*goast.Ident); ok && id.Name == "lowering" {
						loweringFile = true
					}
				}
			}
			for _, decl := range tree.Decls {
				fn, ok := decl.(*goast.FuncDecl)
				if !ok {
					continue
				}
				parserHook := dir == "parser" && (base == "vibelang.go" || strings.HasPrefix(base, "vibelang_") || strings.HasPrefix(fn.Name.Name, "parseVibeLang") || strings.HasPrefix(fn.Name.Name, "isStartOfVibeLang"))
				lowering := dir == "vibelang" && loweringFile
				if parserHook || lowering {
					symbol := fn.Name.Name
					if fn.Recv != nil {
						typ := fn.Recv.List[0].Type
						if ptr, ok := typ.(*goast.StarExpr); ok {
							typ = ptr.X
						}
						if index, ok := typ.(*goast.IndexExpr); ok {
							typ = index.X
						}
						if index, ok := typ.(*goast.IndexListExpr); ok {
							typ = index.X
						}
						id, ok := typ.(*goast.Ident)
						if !ok {
							return nil, fmt.Errorf("%s: unsupported receiver of %s", base, symbol)
						}
						symbol = id.Name + "." + symbol
					}
					hooks[dir+"/"+base+":"+symbol] = true
				}
			}
		}
	}
	return hooks, nil
}

// Check returns the table's errors and the rows whose hook is gone. specPath
// locates a specification chapter.
func Check(hooks map[string]bool, data string, specPath func(chapter string) string) (errs, stale []string) {
	seen := map[string]bool{}
	for i, line := range strings.Split(data, "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) != 5 {
			errs = append(errs, fmt.Sprintf("line %d: want hook, form, authority, status, reason", i+1))
			continue
		}
		hook, form, authority, status := f[0], f[1], f[2], f[3]
		if seen[hook] {
			errs = append(errs, "duplicate hook "+hook)
		}
		seen[hook] = true
		base, _, _ := strings.Cut(hook, "@")
		seen[base] = true
		if !hooks[base] {
			stale = append(stale, hook)
		}
		if !strings.HasPrefix(form, "admission:") || f[4] == "" {
			errs = append(errs, hook+": missing form/reason")
		}
		if authority == "-" {
			if status != "pending" {
				errs = append(errs, hook+": no authority must be pending")
			}
			continue
		}
		if status != "admitted" && status != "support" && status != "recovery" {
			errs = append(errs, fmt.Sprintf("%s: invalid status %s", hook, status))
		}
		for _, reference := range strings.Split(authority, ",") {
			file, production, _ := strings.Cut(strings.TrimSpace(reference), "#")
			if filepath.Base(file) != file || !strings.HasSuffix(file, ".md") ||
				filepath.Dir(specPath(file)) != filepath.Dir(specPath(appendix)) {
				errs = append(errs, fmt.Sprintf("%s: authority %s must name a current specification chapter", hook, reference))
				continue
			}
			text, err := os.ReadFile(specPath(file))
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: authority: %v", hook, err))
				continue
			}
			if production != "" && !strings.Contains(string(text), "#### "+production+"\n") {
				errs = append(errs, fmt.Sprintf("%s: authority %s is not an Appendix A production", hook, reference))
			}
		}
	}
	var missing []string
	for hook := range hooks {
		if !seen[hook] {
			missing = append(missing, hook)
		}
	}
	slices.Sort(missing)
	for _, hook := range missing {
		errs = append(errs, fmt.Sprintf("unaccounted syntax/lowering hook %s; add its spec authority or pending admission:<form>", hook))
	}
	return errs, stale
}
