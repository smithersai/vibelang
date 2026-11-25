package ast

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// Every NodeFlagsVibeLang* constant is read on nodes of any kind, so two of
// them sharing a bit make one form look like another (#498). Reading the
// declarations covers constants added later.
func TestVibeLangNodeFlagsAreDistinctBits(t *testing.T) {
	t.Parallel()
	file, err := parser.ParseFile(token.NewFileSet(), "nodeflags.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	values := map[string]NodeFlags{
		"NodeFlagsVibeLang":                 NodeFlagsVibeLang,
		"NodeFlagsVibeLangIntrinsic":        NodeFlagsVibeLangIntrinsic,
		"NodeFlagsVibeLangTry":              NodeFlagsVibeLangTry,
		"NodeFlagsVibeLangEffect":           NodeFlagsVibeLangEffect,
		"NodeFlagsVibeLangPatternRead":      NodeFlagsVibeLangPatternRead,
		"NodeFlagsVibeLangConst":            NodeFlagsVibeLangConst,
		"NodeFlagsVibeLangIsBinding":        NodeFlagsVibeLangIsBinding,
		"NodeFlagsVibeLangIterationCell":    NodeFlagsVibeLangIterationCell,
		"NodeFlagsVibeLangPatternHoist":     NodeFlagsVibeLangPatternHoist,
		"NodeFlagsVibeLangDoCompletion":     NodeFlagsVibeLangDoCompletion,
		"NodeFlagsVibeLangShorthandBinding": NodeFlagsVibeLangShorthandBinding,
		"NodeFlagsVibeLangTemporary":        NodeFlagsVibeLangTemporary,
		"NodeFlagsVibeLangDoMethodBind":     NodeFlagsVibeLangDoMethodBind,
		"NodeFlagsVibeLangBindingCleanup":   NodeFlagsVibeLangBindingCleanup,
		"NodeFlagsVibeLangUncountedPattern": NodeFlagsVibeLangUncountedPattern,
		"NodeFlagsVibeLangPatternBinding":   NodeFlagsVibeLangPatternBinding,
		"NodeFlagsVibeLangSpec":             NodeFlagsVibeLangSpec,
		"NodeFlagsVibeLangIsHolder":         NodeFlagsVibeLangIsHolder,
		"NodeFlagsVibeLangProof":            NodeFlagsVibeLangProof,
	}
	var declared []string
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			for _, name := range spec.(*ast.ValueSpec).Names {
				if strings.HasPrefix(name.Name, "NodeFlagsVibeLang") {
					declared = append(declared, name.Name)
				}
			}
		}
	}
	if len(declared) != len(values) {
		t.Fatalf("nodeflags.go declares %d VibeLang flags %v; list each one here", len(declared), declared)
	}
	owners := map[NodeFlags]string{}
	for _, name := range declared {
		flag, ok := values[name]
		if !ok {
			t.Fatalf("%s is not listed in this test", name)
		}
		if flag == 0 || flag&(flag-1) != 0 {
			t.Errorf("%s = %#x is not a single bit", name, uint64(flag))
		}
		if other, ok := owners[flag]; ok {
			t.Errorf("%s and %s share bit %#x", name, other, uint64(flag))
		}
		owners[flag] = name
	}
}
