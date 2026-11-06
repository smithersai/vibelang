package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestServiceUnionKeyMisuses(t *testing.T) {
	forms := []struct{ name, prefix string }{
		{"body", `service S {static readonly key="union/S";value:number};service T {static readonly key="union/T";value:number};`},
		{"whole", `service S: {value:number} {static readonly key="union/S"};service T: {value:number} {static readonly key="union/T"};`},
		{"reference", `service S {static readonly key="union/S";static readonly defaultValue=()=>({value:1});value:number};service T {static readonly key="union/T";static readonly defaultValue=()=>({value:1});value:number};`},
	}
	bounds := []struct{ name, head, typ string }{
		{"generic", "Key extends typeof S|typeof T", "Key"},
		{"indexed", "Box extends {key:typeof S|typeof T}", `Box["key"]`},
		{"tuple", "Keys extends readonly [typeof S|typeof T]", "Keys[0]"},
		{"array", "Keys extends ReadonlyArray<typeof S|typeof T>", "Keys[number]"},
		{"intersection", "Key extends (typeof S&{extra?:number})|(typeof T&{extra?:number})", "Key"},
	}
	operations := []struct {
		name, body string
		code       int32
	}{
		{"instanceof", "return value instanceof key", 3004},
		{"pattern", "return match(value){when key:1;default:0;}", 3004},
		{"extractor", "return match(value){when key():1;default:0;}", 3004},
		{"new", "return new key()", 3003},
		{"extends", "class Child extends key {};return Child", 3002},
	}
	for _, form := range forms {
		for _, bound := range bounds {
			for _, op := range operations {
				t.Run(form.name+"/"+bound.name+"/"+op.name, func(t *testing.T) {
					source := form.prefix + fmt.Sprintf("export function inspect<%s>(key:%s,value:unknown){%s}", bound.head, bound.typ, op.body)
					serviceCaptureRecoveryErrors(t, source, map[int32]int{op.code: 1})
				})
			}
		}
	}
}

func TestServiceUnionKeyMixedControls(t *testing.T) {
	prefix := `service S {static readonly key="union/Mixed";value:number};class T {};`
	for _, body := range []string{"return value instanceof key", "return match(value){when key:1;default:0;}", "class Child extends key {};return Child"} {
		t.Run(body, func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, prefix+"export function inspect<Key extends typeof S|typeof T>(key:Key,value:unknown){"+body+"}", map[int32]int{})
		})
	}
	serviceCaptureRecoveryErrors(t, prefix+"export function inspect<Key extends typeof S|typeof T>(key:Key){return new key()}", map[int32]int{2511: 1})
}

func TestServiceUnionKeyIdentityRemainsAmbiguous(t *testing.T) {
	source := `service S {static readonly key="union/IdentityS";value:number};service T {static readonly key="union/IdentityT";value:number};export function inspect<Key extends typeof S|typeof T>(key:Key){return key}`
	p, file, _, _ := editorProgram(t, source)
	p.BindSourceFiles()
	c, done := p.GetTypeChecker(t.Context())
	defer done()
	found := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsReturnStatement(n) && n.Expression() != nil {
			found = true
			if serviceNamedBy(c, n.Expression()) != nil {
				t.Error("distinct keys acquired one declaration identity")
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !found {
		t.Fatal("missing return operand")
	}
}

func TestServiceUnionKeyIdentifierControls(t *testing.T) {
	prefix := `service S {static readonly key="union/IdentifierS";value:number};service T {static readonly key="union/IdentifierT";value:number};`
	for _, body := range []string{"return value instanceof key", "return match(value){when key:1;default:0;}", "return new key()", "class Child extends key {};return Child"} {
		t.Run(body, func(t *testing.T) {
			serviceCaptureRecoveryErrors(t, prefix+"export function inspect<Key extends (S|T)&{new():object}>(key:Key,value:unknown){"+body+"}", map[int32]int{})
		})
	}
	serviceCaptureRecoveryErrors(t, prefix+"export function inspect<Key extends (S|T)&((value:unknown)=>unknown[])>(key:Key,value:unknown){return match(value){when key():1;default:0;}}", map[int32]int{})
}
