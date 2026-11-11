package vibelang

import (
	"strings"
	"testing"
)

func TestAwaitHandleAdviceRegression(t *testing.T) {
	hosts := []struct{ key, source string }{
		{"declaration", "export effect function f(){void (await EXPR)}"},
		{"expression", "export const f=effect function(){void (await EXPR)}"},
		{"arrow", "export const f=effect ()=>{void (await EXPR)}"},
		{"block", "export const f=effect {void (await EXPR)}"},
		{"producer", "export effect function* f(){void (await EXPR);yield 1}"},
		{"method", "export class C{effect f(){void (await EXPR)}}"},
		{"object-method", "export const o={effect f(){void (await EXPR)}}"},
		{"parameter", "export effect function f(value=await EXPR){void value}"},
		{"arrow-parameter", "export const f=effect (value=await EXPR)=>{void value}"},
		{"producer-parameter", "export effect function* f(value=await EXPR){yield value}"},
		{"static-nested", "export class C{static {void (()=>{void (effect ()=>{void (await EXPR)})})}}"},
		{"region", "export effect function f(){uninterruptible {void (await EXPR)}}"},
		{"concurrent", "export effect function f(){for concurrent(const n of [1]){void (await EXPR)}}"},
		{"do", "export effect function f(){const value=do{await EXPR;0};return value}"},
		{"async-control", "export async function f(){void (await EXPR)}"},
	}

	operands := []struct{ key, source, note string }{
		{"missing", "missingValue", ""},
		{"property", "({n:1}).missingValue", ""},
		{"call", "missingCall()", ""},
		{"any", "(undefined as any)", ""},
		{"never", "(undefined as never)", ""},
		{"unknown", "(undefined as unknown)", ""},
		{"null", "null", ""},
		{"undefined", "undefined", ""},
		{"fiber", "fiber", "Join the fiber"},
		{"deferred", "deferred", "Wait for the Deferred"},
	}
	for _, host := range hosts {
		for _, operand := range operands {
			t.Run(host.key+"/"+operand.key, func(t *testing.T) {
				source := "import {Fiber,Deferred} from \"effect\";declare const fiber:Fiber.Fiber<number>;declare const deferred:Deferred.Deferred<number>;" + strings.ReplaceAll(host.source, "EXPR", operand.source)
				errors := errorsOf(t, source)
				count := 0
				for _, d := range errors {
					if d.Source() != diagnosticSource || d.Code() != 102 {
						continue
					}
					count++
					notes := notesOf(d)
					if operand.note != "" {
						if !strings.Contains(notes, operand.note) {
							t.Errorf("known handle lost repair %q: %s", operand.note, notes)
						}
					} else if strings.Contains(notes, "Join the fiber") || strings.Contains(notes, "Wait for the Deferred") {
						t.Errorf("unresolved or unchecked operand invented a handle repair: %s", notes)
					}
				}
				want := 1
				if host.key == "async-control" {
					want = 0
				}
				if count != want {
					t.Errorf("placement count %d, want %d; %s", count, want, source)
				}
			})
		}
	}
}
