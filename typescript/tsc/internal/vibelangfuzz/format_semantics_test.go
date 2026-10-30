package vibelangfuzz

import "testing"

func TestToolsFormatSemanticContract(t *testing.T) {
	cases := []struct {
		name, before, after string
		same                bool
	}{
		{"quotes", "export const x = 'ok';", "export const x = \"ok\";", true},
		{"ordinary escapes", "export const x = '\\x61';", "export const x = 'a';", true},
		{"grouping", "export const x = (1);", "export const x = 1;", true},
		{"trailing comma", "export const x = {a: 1,};", "export const x = {a: 1};", true},
		{"function layout", "export function label() { return 'x' }", "export function label() {\n return \"x\";\n}", true},
		{"number spelling", "export const x = 0x10;", "export const x = 16;", true},
		{"bigint spelling", "export const x = 0x10n;", "export const x = 16n;", true},
		{"directive quotes", "'use strict'; function f() {}", "\"use strict\"; function f() {}", true},
		{"lone surrogate", "export const x = '\\uD800';", "export const x = '\\uD801';", false},
		{"data", "export const x = 'a';", "export const x = 'b';", false},
		{"operator", "export const x = a + b;", "export const x = a - b;", false},
		{"receiver", "export const x = obj.m();", "export const x = (0, obj.m)();", false},
		{"direct eval", "eval('x')", "(0, eval)('x')", false},
		{"optional boundary", "export const x = (a?.b).c;", "export const x = a?.b.c;", false},
		{"tagged raw", "export const x = tag`\\x61`;", "export const x = tag`a`;", false},
		{"tagged cooked", "export const x = tag`a`;", "export const x = tag`b`;", false},
		{"regex", "export const x = /a/g;", "export const x = /b/g;", false},
		{"escaped directive", "'use\\x20strict'; function f() {}", "'use strict'; function f() {}", false},
		{"directive grouping", "('use strict'); function f() {}", "'use strict'; function f() {}", false},
		{"directive boundary", "; 'use strict'; function f() {}", "'use strict'; function f() {}", false},
		{"parameter length", "function f(x) {}", "function f(x = 0) {}", false},
		{"function name", "export function f() {}", "export function g() {}", false},
		{"property name", "export const x = {a: 1};", "export const x = {b: 1};", false},
		{"declaration kind", "let x = 1;", "const x = 1;", false},
		{"async", "export function f() {}", "export async function f() {}", false},
		{"generator", "export function f() {}", "export function* f() {}", false},
		{"for child role", "for (a;;) {}", "for (;a;) {}", false},
		{"array hole", "export const x = [1,];", "export const x = [1,,];", false},
		{"binding scope", "{ let x = 1; }", "let x = 1;", false},
		{"declaration type", "export declare const x: string;", "export declare const x: number;", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			name := "out/main.js"
			if c.name == "declaration type" {
				name = "out/main.d.ts"
			}
			before := &Result{Outputs: map[string]string{name: c.before}}
			after := &Result{Outputs: map[string]string{name: c.after}}
			difference := toolsFormatDifference(before, after)
			if (difference == "") != c.same {
				t.Fatalf("same=%v, difference=%q", c.same, difference)
			}
		})
	}
}
