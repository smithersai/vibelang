package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"strings"
	"testing"
)

func TestGenericDataHelperPropertyNames(t *testing.T) {
	t.Run("free", func(t *testing.T) {
		source := "export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("binding", func(t *testing.T) {
		source := "type $Box$Definition=number;export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition$2" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition$2", source)
		}
	})
	t.Run("second-binding", func(t *testing.T) {
		source := "type $Box$Definition=number;type $Box$Definition$2=string;export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition$3" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition$3", source)
		}
	})
	t.Run("object-key", func(t *testing.T) {
		source := "const object={$Box$Definition:1};export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("type-key", func(t *testing.T) {
		source := "interface Shape{$Box$Definition:number};export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("class-field", func(t *testing.T) {
		source := "class Holder{$Box$Definition=1};export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("object-method", func(t *testing.T) {
		source := "const object={$Box$Definition(){return 1}};export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("class-method", func(t *testing.T) {
		source := "class Holder{$Box$Definition(){return 1}};export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("property-read", func(t *testing.T) {
		source := "const object={$Box$Definition:1};const value=object.$Box$Definition;export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("qualified-type-query", func(t *testing.T) {
		source := "const object={$Box$Definition:1};type Kept=typeof object.$Box$Definition;export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
	t.Run("binding-property", func(t *testing.T) {
		source := "const object={$Box$Definition:1};const {$Box$Definition:kept}=object;export data Box<A>{Row{value:A}}"
		_, f, _, _ := editorProgram(t, source)
		got := ""
		for _, n := range f.Statements.Nodes {
			if ast.IsInterfaceDeclaration(n) && strings.HasPrefix(n.Name().Text(), "$Box$Definition") {
				got = n.Name().Text()
			}
		}
		if got != "$Box$Definition" {
			t.Errorf("helper=%s want=%s\n%s", got, "$Box$Definition", source)
		}
	})
}

func TestGenericDataHelperPropertyDeclarations(t *testing.T) {
	t.Run("free", func(t *testing.T) {
		source := "export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("binding", func(t *testing.T) {
		source := "type $Box$Definition=number;export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition$2 extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("second-binding", func(t *testing.T) {
		source := "type $Box$Definition=number;type $Box$Definition$2=string;export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition$3 extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("object-key", func(t *testing.T) {
		source := "const object={$Box$Definition:1};export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("type-key", func(t *testing.T) {
		source := "interface Shape{$Box$Definition:number};export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("class-field", func(t *testing.T) {
		source := "class Holder{$Box$Definition=1};export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("object-method", func(t *testing.T) {
		source := "const object={$Box$Definition(){return 1}};export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("class-method", func(t *testing.T) {
		source := "class Holder{$Box$Definition(){return 1}};export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("property-read", func(t *testing.T) {
		source := "const object={$Box$Definition:1};const value=object.$Box$Definition;export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("qualified-type-query", func(t *testing.T) {
		source := "const object={$Box$Definition:1};type Kept=typeof object.$Box$Definition;export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
	t.Run("binding-property", func(t *testing.T) {
		source := "const object={$Box$Definition:1};const {$Box$Definition:kept}=object;export data Box<A>{Row{value:A}}"
		out := genericDataHelperDeclarations(t, source)
		if !strings.Contains(out, "interface $Box$Definition extends") {
			t.Errorf("wrong declaration helper: %s", out)
		}
	})
}
