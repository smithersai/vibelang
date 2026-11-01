package vibelangfuzz

import (
	"fmt"
	goast "go/ast"
	goparser "go/parser"
	gotoken "go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Admission is deliberately a source census, not a list of today's passing
// programs. Even recovery and implementation helpers must be accounted for.
// The table does not grant authority to denied, open or legacy forms.
func admissionHooks(t *testing.T) map[string]bool {
	t.Helper()
	hooks := map[string]bool{}
	for _, dir := range []string{"parser", "vibelang"} {
		files, err := filepath.Glob(filepath.Join(Root(), "typescript/tsc/internal", dir, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			base := filepath.Base(file)
			if strings.HasSuffix(base, "_test.go") {
				continue
			}
			tree, err := goparser.ParseFile(gotoken.NewFileSet(), file, nil, 0)
			if err != nil {
				t.Fatal(err)
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
							t.Fatalf("%s: unsupported receiver of %s", base, symbol)
						}
						symbol = id.Name + "." + symbol
					}
					hooks[dir+"/"+base+":"+symbol] = true
				}
			}
		}
	}
	return hooks
}

// TestGrammarAdmissionInventory is in the fast spec gate. A new parser hook or
// lowering cannot land without an explicit row; duplicate rows and invented
// Appendix A production names fail too. A row whose hook is gone is only
// reported: main reverts land under time pressure, and a kept row lets a
// revert that restores its hook pass without editing this table.
func TestGrammarAdmissionInventory(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(repoTestdata(), "grammar_admission.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	hooks := admissionHooks(t)
	errs, stale := checkAdmissionInventory(hooks, string(data))
	for _, e := range errs {
		t.Error(e)
	}
	for _, hook := range stale {
		t.Logf("row for a removed hook (kept for reverts; delete when the removal is final): %s", hook)
	}
	t.Logf("%d parser/support and lowering hooks accounted for", len(hooks))
}

// A revert in either direction passes: a removed hook leaves a stale row,
// and restoring the hook finds it again. Only a hook with no row fails.
func TestGrammarAdmissionInventoryReverts(t *testing.T) {
	rows := "parser/vibelang_a.go:Parser.a\tadmission:a\t900-appendices.md\tsupport\tr\n" +
		"parser/vibelang_gone.go:Parser.gone\tadmission:gone\t-\tpending\tr\n"
	errs, stale := checkAdmissionInventory(map[string]bool{"parser/vibelang_a.go:Parser.a": true, "parser/vibelang_new.go:Parser.added": true}, rows)
	if len(errs) != 1 || !strings.Contains(errs[0], "unaccounted syntax/lowering hook parser/vibelang_new.go:Parser.added") {
		t.Fatalf("a hook with no row must fail alone: %q", errs)
	}
	if len(stale) != 1 || stale[0] != "parser/vibelang_gone.go:Parser.gone" {
		t.Fatalf("a removed hook's row must be reported, not failed: %q", stale)
	}
}

func checkAdmissionInventory(hooks map[string]bool, data string) (errs, stale []string) {
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
				filepath.Dir(SpecPath(file)) != filepath.Dir(SpecPath(grammarAppendix)) {
				errs = append(errs, fmt.Sprintf("%s: authority %s must name a current specification chapter", hook, reference))
				continue
			}
			text, err := os.ReadFile(SpecPath(file))
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
