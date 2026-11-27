// An unshipped, parser-only oracle for the editor grammar properties. No checker
// or ESTree converter participates: neither defines syntactic acceptance.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

type request struct {
	Sources  []string `json:"sources"`
	Generate *[]int   `json:"generate"`
}

type span struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Kind  string `json:"kind,omitempty"`
}

type form struct {
	Name  string `json:"name"`
	Range span   `json:"range"`
	Left  span   `json:"left"`
	Right span   `json:"right"`
}

type result struct {
	Source      string       `json:"source"`
	Valid       bool         `json:"valid"`
	Statements  []span       `json:"statements"`
	Forms       []form       `json:"forms"`
	Diagnostics []diagnostic `json:"diagnostics"`
}

type diagnostic struct {
	Code    int32  `json:"code"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Message string `json:"message"`
}

func bounds(r core.TextRange) span { return span{Start: r.Pos(), End: r.End()} }

func parse(source string) result {
	file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/property.vibe", PathKey: "/property.vibe"}, source)
	r := result{Source: source, Valid: true, Statements: []span{}, Forms: []form{}, Diagnostics: []diagnostic{}}
	// Inline module bodies are parsed as supplemental TypeScript source files.
	for _, f := range append([]*ast.SourceFile{file}, file.SupplementalSourceFiles()...) {
		for _, d := range f.Diagnostics() {
			r.Valid = false
			r.Diagnostics = append(r.Diagnostics, diagnostic{d.Code(), d.Pos(), d.Pos() + d.Len(), d.String()})
		}
	}
	// Parser desugaring adds companion declarations anchored inside their source
	// declaration. Compare surface statement boundaries, merging those anchors.
	for _, node := range file.Statements.Nodes {
		if node.Pos() >= 0 && node.End() > node.Pos() {
			r.Statements = append(r.Statements, span{scanner.SkipTrivia(source, node.Pos()), node.End(), node.Kind.String()})
		}
	}
	slices.SortFunc(r.Statements, func(a, b span) int {
		if a.Start != b.Start {
			return a.Start - b.Start
		}
		return b.End - a.End
	})
	merged := []span{}
	for _, s := range r.Statements {
		if len(merged) == 0 || s.Start >= merged[len(merged)-1].End {
			merged = append(merged, s)
		} else if s.End > merged[len(merged)-1].End {
			merged[len(merged)-1].End = s.End
			merged[len(merged)-1].Kind = s.Kind
		}
	}
	r.Statements = merged
	for _, f := range forms {
		if f.Kind == parser.VibeSyntaxDeclaration || f.Kind == parser.VibeSyntaxModule || f.Kind == parser.VibeSyntaxBlockStatement {
			for i := range r.Statements {
				if r.Statements[i].Start == f.Range.Pos() {
					r.Statements[i].Kind = "vibe:" + f.Name
					if f.Kind == parser.VibeSyntaxModule {
						r.Statements[i].Kind = "vibe:module"
					}
					if f.Kind == parser.VibeSyntaxBlockStatement {
						r.Statements[i].Kind = "vibe:" + source[f.Word.Pos():f.Word.End()]
					}
				}
			}
		}
		name := ""
		switch f.Kind {
		case parser.VibeSyntaxCatch:
			name = "catch_expression"
		case parser.VibeSyntaxPipe:
			name = "pipe_expression"
		}
		if name != "" {
			r.Forms = append(r.Forms, form{name, bounds(f.Range), bounds(f.Left), bounds(f.Right)})
		}
	}
	return r
}

// generatedSources keeps TypeScript siblings out of the .vibe parser oracle.
func generatedSources(data []byte) []string {
	program := vipgen.Generate(data, nil)
	if program == nil {
		return nil
	}
	sources := []string{vipgen.PrintVibe(program)}
	names := make([]string, 0, len(program.Files))
	for name := range program.Files {
		if strings.EqualFold(filepath.Ext(name), ".vibe") {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	for _, name := range names {
		sources = append(sources, program.Files[name])
	}
	return sources
}

func main() {
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 4096), 8<<20)
	output := json.NewEncoder(os.Stdout)
	for input.Scan() {
		var q request
		if err := json.Unmarshal(input.Bytes(), &q); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if q.Generate != nil {
			data := make([]byte, len(*q.Generate))
			for i, b := range *q.Generate {
				data[i] = byte(b)
			}
			q.Sources = append(q.Sources, generatedSources(data)...)
		}
		results := []result{}
		for _, source := range q.Sources {
			results = append(results, parse(source))
		}
		if err := output.Encode(results); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if err := input.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
