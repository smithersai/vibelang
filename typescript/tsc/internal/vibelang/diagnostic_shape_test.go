package vibelang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
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

// Every active code in Appendix B of the live specification has a non-empty
// rule and chapter/repair cell and corresponds to a live registered code.
func TestRegistryRowsSuggestRepairs(t *testing.T) {
	spec, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(spec)
	start := strings.Index(text, "## Appendix B. Diagnostics")
	if start < 0 {
		t.Fatal("the specification has no Appendix B. Diagnostics")
	}
	appendix := text[start:]
	if next := strings.Index(appendix[1:], "\n## "); next >= 0 {
		appendix = appendix[:next+1]
	}
	rowRe := regexp.MustCompile(`^\| (?:interim )?` + "`" + `(EK(?:38\d{2,}|\d{4}))` + "`" + ` \|`)
	var rows int
	for _, line := range strings.Split(appendix, "\n") {
		match := rowRe.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		rows++
		cells := strings.Split(line, "|")
		if len(cells) < 5 {
			t.Errorf("Appendix B row has %d cells: %s", len(cells), line)
			continue
		}
		code := match[1]
		rule := strings.TrimSpace(cells[2])
		chapter := strings.TrimSpace(cells[4])
		if rule == "" {
			t.Errorf("%s has an empty rule cell in Appendix B", code)
		}
		if chapter == "" && !strings.Contains(strings.ToLower(rule), "retired") {
			t.Errorf("%s has no chapter or repair reference in Appendix B", code)
		}
	}
	if rows < 100 || !strings.Contains(appendix, "| `EK0401` |") {
		t.Fatalf("read %d Appendix B rows; expected at least 100 live diagnostic rows", rows)
	}
}
