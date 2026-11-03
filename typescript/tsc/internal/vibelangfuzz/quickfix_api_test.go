package vibelangfuzz

import (
	"os"
	"path/filepath"
	"testing"
)

func TestQuickFixAPIObserves(t *testing.T) {
	w := NewWorkspace(t)
	api := declarationIdentityAPI(t)
	requireQuickfixTS593(t, api)
	for _, pair := range []struct {
		name, before, after string
		same                bool
	}{
		{"identical", "export declare function main(): number;", "export declare function main(): number;", true},
		{"return", "export declare function main(): 1 | 2;", "export declare function main(): number;", false},
		{"promise", "export declare function main(): Promise<number>;", "export declare function main(): Promise<void>;", false},
		{"generator", "export declare function main(): Generator<number, number>;", "export declare function main(): Generator<number, void>;", false},
		{"type-added", "export interface A {id:number}", "export interface A {id:number}; export type B = string;", false},
		{"type-removed", "export interface A {id:number}; export type B = string;", "export interface A {id:number}", false},
		{"generic", "export type A<T> = T[];", "export type A<T> = string[];", false},
		{"constrained-generic", "export type A<T extends string> = T[];", "export type A<T extends string> = string[];", false},
		{"shadowed-generic-name", "export type T<T> = T[];", "export type T<T> = T[];", true},
		{"local-constraint", "interface Base { id: string } export type A<T extends Base> = T[];", "interface Base { id: string } export type A<T extends Base> = T[];", true},
	} {
		t.Run(pair.name, func(t *testing.T) {
			dir := filepath.Join(w.Dir, pair.name)
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			for side, source := range map[string]string{"a": pair.before, "b": pair.after} {
				if err := writeInside(dir, side+"/main.d.ts", source); err != nil {
					t.Fatal(err)
				}
			}
			output, err := quickfixTS593Contracts(t, api, dir, []string{"main"})
			if (err == nil) != pair.same {
				t.Fatalf("same=%t err=%v\n%s", pair.same, err, output)
			}
		})
	}
}
