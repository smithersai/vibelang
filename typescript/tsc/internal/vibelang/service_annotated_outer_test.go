package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// Chapter 005 / VIP-9: an annotated whole shape cannot capture enclosing
// generics, just as the equivalent written implementation member cannot.
func TestServiceAnnotatedOuterTypeParameters(t *testing.T) {
	for _, test := range []struct {
		name, source string
		captured     bool
	}{
		{"object", "export function f<T>():number { service S: {readonly value:T} { static readonly key=\"shape104/object\" }; return 1 }", true},
		{"alias", "export function f<T>():number {type Box<U> = {readonly value:U}; service S: Box<T> { static readonly key=\"shape104/alias\" }; return 1 }", true},
		{"array", "export function f<T>():number { service S: {readonly values:ReadonlyArray<T>} { static readonly key=\"shape104/array\" }; return 1 }", true},
		{"callable", "export function f<T>():number { service S: (value:T)=>T { static readonly key=\"shape104/callable\" }; return 1 }", true},
		{"member-bound", "export function f<T>():number { service S: {pick<U extends T>(value:U):U} { static readonly key=\"shape104/member-bound\" }; return 1 }", true},
		{"conditional", "export function f<T>():number { service S: {pick<U>():U extends string ? T : number} { static readonly key=\"shape104/conditional\" }; return 1 }", true},
		{"mapped", "export function f<T extends object>():number { service S: {[K in keyof T]:T[K]} { static readonly key=\"shape104/mapped\" }; return 1 }", true},
		{"indexed", "export function f<T extends {value:unknown}>():number { service S: {readonly value:T[\"value\"]} { static readonly key=\"shape104/indexed\" }; return 1 }", true},
		{"direct", "export function f<T>():number { service S: T { static readonly key=\"shape104/direct\" }; return 1 }", true},
		{"method-return", "export function f<T>():number { service S: {get():T!!} { static readonly key=\"shape104/method-return\" }; return 1 }", true},
		{"concrete", "export function f<T>():number { service S: {readonly value:number} { static readonly key=\"shape104/concrete\" }; return 1 }", false},
		{"member-local", "export function f<T>():number { service S: {pick<U>(value:U):U} { static readonly key=\"shape104/member-local\" }; return 1 }", false},
		{"erased", "export function f<T>():number {type Ignore<U> = {readonly value:number}; service S: Ignore<T> { static readonly key=\"shape104/erased\" }; return 1 }", false},
		{"phantom", "export function f<T>():number {interface Phantom<U> {readonly value:number}; service S: Phantom<T> { static readonly key=\"shape104/phantom\" }; return 1 }", false},
		{"recursive-phantom", "export function f<T>():number {interface Phantom<U> {readonly next?:Phantom<U[]>;readonly value:number}; service S: Phantom<T> { static readonly key=\"shape104/recursive-phantom\" }; return 1 }", false},
		{"class-constructor", "export class Host<T> { constructor() { service S: {readonly value:T} {static readonly key=\"shape104/constructor\"} } }", true},
		{"class-getter", "export class Host<T> { get value():number { service S: {readonly value:T} {static readonly key=\"shape104/getter\"}; return 1 } }", true},
		{"native-context-control", "export function f<T>():number {class Native extends Context.Service<Native,{readonly value:T}>()(\"shape104/native\") {}; return 1}", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			var codes []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				codes = append(codes, d.Code())
				if d.Code() == EK3005.Code && !strings.Contains(d.MessageText(), "T") {
					t.Errorf("capture diagnostic omits T: %s", d.String())
				}
			}
			if test.captured {
				if len(codes) != 1 || codes[0] != EK3005.Code {
					t.Fatalf("want one EK3005 for annotated capture, got %v", codes)
				}
			} else if len(codes) != 0 {
				t.Fatalf("concrete/member-local control rejected: %v", codes)
			}
		})
	}
}
