package vibelang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// A VibeLang diagnostic is read in an editor's hover and in a terminal, by
// someone who has not read the specification. Its text says what is wrong in
// the words the user docs teach, and its notes give the fix as code. These
// lints read every message, variant and note in this package's sources, so a
// new diagnostic keeps that shape without a test of its own.

// diagnosticText is one text a diagnostic prints: a message, a variant
// (Message.With), a note, or a constant that holds a note.
type diagnosticText struct {
	at   string // file:line
	text string
}

// diagnosticTexts returns the texts in the non-test sources of this package
// and of the content mapper, vibelangmapper, which reports the same codes to
// TypeScript's own compiler.
func diagnosticTexts(t *testing.T) []diagnosticText {
	t.Helper()
	var files []string
	for _, pattern := range []string{"*.go", "../vibelangmapper/*.go"} {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, matches...)
	}
	fset := token.NewFileSet()
	var texts []diagnosticText
	add := func(expr ast.Expr) {
		if text, ok := stringConstant(expr); ok {
			texts = append(texts, diagnosticText{at: fset.Position(expr.Pos()).String(), text: text})
		}
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			switch node := node.(type) {
			case *ast.CallExpr:
				switch callee := node.Fun.(type) {
				case *ast.Ident:
					if callee.Name == "message" && len(node.Args) == 3 {
						add(node.Args[2])
					}
					if callee.Name == "note" && len(node.Args) >= 2 {
						add(node.Args[1])
					}
				case *ast.SelectorExpr:
					if callee.Sel.Name == "With" && len(node.Args) == 1 && strings.HasPrefix(exprName(callee.X), "EK") {
						add(node.Args[0])
					}
					// vibelangmapper's p.fiberDiagnostic(node, code, text) and its siblings
					if strings.HasSuffix(callee.Sel.Name, "Diagnostic") || callee.Sel.Name == "syntaxToken" {
						if len(node.Args) == 3 {
							add(node.Args[2])
						}
					}
				}
			case *ast.KeyValueExpr:
				// Diagnostic{…, Message: text} in vibelangmapper, and a match
				// arm's classArmCredit{why: text}
				if key := exprName(node.Key); key == "Message" || key == "why" {
					add(node.Value)
				}
			case *ast.ValueSpec:
				for i, name := range node.Names {
					if strings.HasSuffix(name.Name, "Note") && i < len(node.Values) {
						add(node.Values[i])
					}
				}
			}
			return true
		})
	}
	if len(texts) < 100 {
		t.Fatalf("found only %d diagnostic texts; the lint no longer reads the sources", len(texts))
	}
	return texts
}

// stringConstant returns the value of a string literal, or of a sum of them
// and of other expressions, whose parts it joins with {} for what it cannot
// read.
func stringConstant(expr ast.Expr) (string, bool) {
	switch expr := expr.(type) {
	case *ast.BasicLit:
		if expr.Kind == token.STRING {
			text, err := strconv.Unquote(expr.Value)
			return text, err == nil
		}
	case *ast.BinaryExpr:
		if expr.Op == token.ADD {
			left, lok := stringConstant(expr.X)
			right, rok := stringConstant(expr.Y)
			if !lok {
				left = "{}"
			}
			if !rok {
				right = "{}"
			}
			return left + right, lok || rok
		}
	case *ast.ParenExpr:
		return stringConstant(expr.X)
	}
	return "", false
}

func exprName(expr ast.Expr) string {
	if ident, ok := expr.(*ast.Ident); ok {
		return ident.Name
	}
	return ""
}

// Decision and specification numbers, such as D282 or S10-11, and the
// specification's internal words mean nothing to someone reading a
// diagnostic: the user docs never teach them.
func TestDiagnosticTextsUseUserWords(t *testing.T) {
	internal := regexp.MustCompile(`\bD\d{2,3}\b|\bS\d+-\d+\b|(?i)\bvisitor spelling\b|\bown form\b|\brule [RF]\b|\bplain variant\b|\bkept as data\b|\blook-ahead\b`)
	for _, text := range diagnosticTexts(t) {
		if match := internal.FindString(text.text); match != "" {
			t.Errorf("%s: %q uses %q, which the user docs don't teach", text.at, text.text, match)
		}
	}
}

// A diagnostic's text is a sentence: one that starts with an English word,
// rather than with code such as a keyword or a placeholder, starts with a
// capital letter, as TypeScript's own messages do.
func TestDiagnosticTextsStartAsSentences(t *testing.T) {
	lowercase := regexp.MustCompile(`^(a|an|the|this|these|that|two|no|every|each|one|it|its|there|use|write|move|add|call|remove|or|and|but)\b`)
	for _, text := range diagnosticTexts(t) {
		if match := lowercase.FindString(text.text); match != "" {
			t.Errorf("%s: %q starts with %q in lower case", text.at, text.text, match)
		}
	}
}

// Every code that Chapter 28's registry has not retired suggests a repair.
func TestRegistryRowsSuggestRepairs(t *testing.T) {
	spec, err := os.ReadFile("../../../../docs/design/history/src/428-part4-ch28-tooling.md")
	if os.IsNotExist(err) {
		// The old Chapter 28 registry lives in docs/design/history; the new
		// specification has no registry until VIP-34's diagnostics are assigned.
		// Without the history copy, the Go registry is the source of truth.
		t.Skip("the specification has no Chapter 28 registry until VIP-34's diagnostics appendix lands")
	}
	if err != nil {
		t.Fatal(err)
	}
	var rows int
	for _, line := range strings.Split(string(spec), "\n") {
		if !regexp.MustCompile(`^\| EK\d{4} \|`).MatchString(line) {
			continue
		}
		rows++
		cells := strings.Split(line, "|")
		if len(cells) < 6 {
			t.Errorf("registry row has %d cells: %s", len(cells), line)
			continue
		}
		code, reports, repair := strings.TrimSpace(cells[1]), strings.TrimSpace(cells[2]), strings.TrimSpace(cells[3])
		if repair == "" && !strings.HasPrefix(reports, "Retired") {
			t.Errorf("%s has no suggested repair", code)
		}
	}
	if rows < 100 || !slices.ContainsFunc(strings.Split(string(spec), "\n"), func(line string) bool { return strings.HasPrefix(line, "| EK2003 |") }) {
		t.Fatalf("read %d registry rows; the lint no longer reads Chapter 28", rows)
	}
}
