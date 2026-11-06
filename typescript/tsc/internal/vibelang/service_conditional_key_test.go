package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

var serviceConditionalForms = []struct{ name, prefix string }{
	{"body", "service S {static readonly key=\"conditional/S\";value:number};service T {static readonly key=\"conditional/T\";value:number};"},
	{"whole", "service S:{value:number} {static readonly key=\"conditional/S\"};service T:{value:number} {static readonly key=\"conditional/T\"};"},
	{"reference", "service S {static readonly key=\"conditional/S\";static readonly defaultValue=()=>({value:1});value:number};service T {static readonly key=\"conditional/T\";static readonly defaultValue=()=>({value:1});value:number};"},
}
var serviceConditionalBounds = []struct{ name, head, typ, alias string }{
	{"conditional", "Flag extends boolean", "Key<Flag>", "type Key<F extends boolean>=F extends true?typeof S:typeof T;"},
	{"same-key", "Flag extends boolean", "Key<Flag>", "type Key<F extends boolean>=F extends true?typeof S:typeof S;"},
	{"indexed", "Flag extends boolean,Box extends {key:Flag extends true?typeof S:typeof T}", "Box[\"key\"]", ""},
	{"wrapped", "Flag extends boolean", "NoInfer<Key<Flag>>", "type Key<F extends boolean>=F extends true?typeof S:typeof T;"},
	{"extract", "Key extends typeof S|typeof T", "Extract<Key,typeof S|typeof T>", ""},
}
var serviceConditionalOperations = []struct {
	name, body string
	code       int32
}{
	{"instanceof", "return value instanceof key", 3004},
	{"pattern", "return match(value){when key:1;default:0;}", 3004},
	{"extractor", "return match(value){when key():1;default:0;}", 3004},
	{"new", "return new key()", 3003},
	{"extends", "class Child extends key {};return 1", 3002},
}

func TestServiceConditionalKeyMisuses(t *testing.T) {
	for _, form := range serviceConditionalForms {
		for _, bound := range serviceConditionalBounds {
			for _, op := range serviceConditionalOperations {
				t.Run(form.name+"/"+bound.name+"/"+op.name, func(t *testing.T) {
					source := form.prefix + bound.alias + fmt.Sprintf("export function inspect<%s>(key:%s,value:unknown){%s};export const invalid:number=\"wrong\"", bound.head, bound.typ, op.body)
					serviceCaptureRecoveryErrors(t, source, map[int32]int{op.code: 1, 2322: 1})
				})
			}
		}
	}
}

func TestServiceConditionalKeyNativeControls(t *testing.T) {
	for _, bound := range serviceConditionalBounds {
		for _, op := range serviceConditionalOperations {
			t.Run(bound.name+"/"+op.name, func(t *testing.T) {
				prefix := "class S {constructor(..._args:any[]){}};const T=S;"
				if op.name == "extractor" {
					prefix = "function S(_v:unknown):unknown[]{return []};const T=S;"
				}
				source := prefix + bound.alias + fmt.Sprintf("export function inspect<%s>(key:%s,value:unknown){%s}", bound.head, bound.typ, op.body)
				serviceCaptureRecoveryErrors(t, source, map[int32]int{})
			})
		}
	}
}

func TestServiceConditionalKeyIdentity(t *testing.T) {
	for _, test := range []struct {
		name, branches, typ string
		key, unique         bool
	}{
		{"different", "typeof S:typeof T", "Key<Flag>", true, false},
		{"same", "typeof S:typeof S", "Key<Flag>", true, true},
		{"identifiers", "S:T", "Key<Flag>", false, false},
		{"identifier-constructors", "S:T", "Key<Flag>&{new(...args:any[]):object}", false, false},
		{"identifier-callables", "S:T", "Key<Flag>&((value:unknown)=>unknown[])", false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := serviceConditionalForms[0].prefix + "type Key<F extends boolean>=F extends true?" + test.branches + ";export function inspect<Flag extends boolean>(key:" + test.typ + "){return key}"
			p, file, _, _ := editorProgram(t, source)
			p.BindSourceFiles()
			c, done := p.GetTypeChecker(t.Context())
			defer done()
			found := false
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsReturnStatement(n) && n.Expression() != nil {
					found = true
					value := n.Expression()
					if got := serviceKeyOperand(c, c.GetTypeAtLocation(value)); got != test.key {
						t.Errorf("key-only=%v,want%v", got, test.key)
					}
					identity := serviceNamedBy(c, value)
					if (identity != nil) != test.unique {
						t.Errorf("unique identity=%v,want%v", identity != nil, test.unique)
					}
					if identity != nil && identity.Name().Text() != "S" {
						t.Errorf("wrong identity %s", identity.Name().Text())
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("missing operand")
			}
		})
	}
}
