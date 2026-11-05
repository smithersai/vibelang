package vipgen

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"
)

func TestDoBindingDefaultReferenceSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	var source strings.Builder
	for jump := range 4 {
		for present := range 2 {
			for closeFails := range 2 {
				for wrapped := range 2 {
					g := &Gen{c: chooser{data: []byte{byte(jump), byte(present), byte(closeFails), byte(wrapped), 9}}, files: map[string]string{}, imports: map[string][]string{}, modules: map[string]bool{}}
					doBindingDefault(g, &Scope{})
					code := g.decls[0].(*Code)
					source.WriteString("{\n" + code.E + "\n}\n")
					if !strings.Contains(code.V, "const [x=") || !strings.Contains(code.E, "for(const value of") {
						t.Fatalf("missing independent binding/jump pair: %d/%d/%d/%d", jump, present, closeFails, wrapped)
					}
				}
			}
		}
	}
	cmd := exec.Command(node, "--input-type=module", "--check")
	cmd.Stdin = strings.NewReader(source.String())
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatal(fmt.Sprintf("reference syntax: %v\n%s\n%s", err, output, source.String()))
	}
}

func TestDoBindingEffectReferenceSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	var source strings.Builder
	for jump := range 6 {
		for present := range 2 {
			for closeFails := range 2 {
				for wrapped := range 2 {
					g := &Gen{c: chooser{data: []byte{byte(jump), byte(present), byte(closeFails), byte(wrapped), 9}}, files: map[string]string{}, imports: map[string][]string{}, modules: map[string]bool{}}
					doBindingEffectDefault(g, &Scope{})
					code := g.decls[0].(*Code)
					source.WriteString("{\n" + code.E + "\n}\n")
					if !strings.Contains(code.V, "effect function") || !strings.Contains(code.E, "for(const value of") {
						t.Fatal("missing native Effect generator binding counterpart")
					}
				}
			}
		}
	}
	cmd := exec.Command(node, "--input-type=module", "--check")
	cmd.Stdin = strings.NewReader(source.String())
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("reference syntax: %v\n%s\n%s", err, output, source.String())
	}
}
