package vibelang

import "testing"

// Details214/240 require the owning diagnostic without moving evaluation.
func TestUnsettledIsBindingHomes(t *testing.T) {
	// Chapter 004: TestUnsettledIsBindingHomes; rule-evidence: docs/design/src/004-match.md#31d9a821bc12c0ed
	for _, tc := range []struct{ name, source string }{
		{"direct", "function f(a=(1 is let one)){return a}"},
		{"catch-default", "function f(){try{(null as any).code}catch({code=(1 is let c)}){}}"},
		{"catch-nested", "function f(){try{(null as any).code}catch({inner:{code=(1 is const c)}={}}){}}"},
		{"catch-computed", "function f(){try{(null as any).code}catch({[(1 is let c)?\"x\":\"y\"]:code}){}}"},
		{"catch-skipped", "function f(){try{(null as any).code}catch({code=false && (1 is let c)}){}}"},
		{"destructuring", "function f({a=(1 is const one)}={}){return a}"},
		{"computed", "function f({[(1 is let one)?\"x\":\"y\"]:value}:{x?:number;y?:number}={}){}"},
		{"nested-parameter", "function outer(){function f(a=(1 is let one)){return a}}"},
		{"skipped", "function f(a=false && (1 is let one)){return a}"},
		{"enum", "enum E{A=(1 is let one)?1:0}"},
		{"enum-skipped", "enum E{A=(false && (1 is let one))?1:0}"},
		{"match-subject", "function f(a=match(1 is let one){default:0;}){return a}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 4703 {
					t.Errorf("legacy unsupported-home diagnostic: %v", d)
				}
				found = found || d.Code() == 705
			}
			if !found {
				t.Fatal("missing EK0705")
			}
		})
	}
}

// These are classification controls, not proof that every settled home is
// implemented. They must never inherit an outer parameter's unsettled home.
func TestUnsettledIsBindingHomeBoundaries(t *testing.T) {
	// Chapter 004: TestUnsettledIsBindingHomeBoundaries; rule-evidence: docs/design/src/004-match.md#355f23e0c3b9c352
	for _, tc := range []struct{ name, source string }{
		{"arrow", "function f(a=():boolean=>(1 is let one)){return a}"},
		{"catch-arrow", "function f(){try{(null as any).code}catch({code=()=>1 is let c}){}}"},
		{"catch-do", "function f(){try{(null as any).code}catch({code=do{const ok=1 is let c;ok}}){}}"},
		{"catch-arm", "function f(){try{(null as any).code}catch({code=match(1){default:(1 is let c);}}){}}"},
		{"field", "function f(a=class{value=(1 is let one)}){return a}"},
		{"match-arm", "function f(a=match(1){default:(1 is let one);}){return a}"},
		{"do-block", "function f(a=do{const ok=(1 is let one);ok}){return a}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 705 {
					t.Errorf("settled source home treated as a parameter: %v", d)
				}
			}
		})
	}
}

func TestUnsettledIsBindingHomeControls(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"binding-free", "function f(a=(1 is Number)){return a}"},
		{"enum-binding-free", "enum E{A=(1 is Number)?1:0}"},
		{"callable-block", "function f(a=(():number=>{if(1 is let one)return one;return 0})()){return a}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			if ds := program.GetSemanticDiagnostics(t.Context(), file); len(ds) != 0 {
				t.Fatalf("control: %v", ds)
			}
		})
	}
}

// VIP-7 reject parameter-environment bindings without relocating initialization; rule: docs/design/vips/0007-match.md#3f108270c1a50ebb

// VIP-7, chapter 004: a for-of RHS binding belongs to the head and each item.
func TestForEachIsBindingHomes(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"rhs", "declare const a: unknown; export function probe() { for (const item of ((a is let cell) && [cell]) || []) { void item; void cell; } }"},
		{"default", "declare const a: unknown; export function probe() { for (const {x=(a is let cell) && cell} of [{}] as {x?:unknown}[]) { void x; void cell; } }"},
		{"in", "declare const a: unknown; export function probe() { for (const item in ((a is let cell) && {key:cell}) || {}) { void item; void cell; } }"},
		{"await", "declare const a: unknown; export async function probe() { for await (const item of ((a is let cell) && [cell]) || []) { void item; void cell; } }"},
		{"var", "declare const a: unknown; export function probe() { for (var item of ((a is let cell) && [cell]) || []) { void item; void cell; } }"},
		{"assignment", "declare const a: unknown; export function probe() { let item: unknown; for (item of ((a is let cell) && [cell]) || []) { void item; void cell; } }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			ds := program.GetSemanticDiagnostics(t.Context(), file)
			if tc.name == "var" {
				if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 107 {
					t.Fatalf("retain the independent var rejection without a home error: %v", ds)
				}
			} else if len(ds) != 0 {
				t.Fatalf("specified lexical home rejected: %v", ds)
			}
		})
	}
}

func TestForEachIsBindingHomeBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"rhs-no-leak", "for (const item of ((1 is let cell) && [cell]) || []) { void cell; } void cell;", 2304},
		{"default-no-leak", "for (const {x=(1 is let cell) && cell} of [{}]) { void x; } void cell;", 2304},
		{"const-copy", "for (const item of ((1 is const cell) && [cell]) || []) { cell = 2; }", 2588},
		{"default-shadow", "for (const item of ((1 is let cell) && [cell]) || []) { const cell = item; void cell; }", 0},
		{"head-collision", "for (const cell of ((1 is let cell) && [cell]) || []) { void cell; }", 2451},
		{"default-collision", "for (const {x=(1 is let cell) && cell} of ((1 is let cell) && [{}]) || []) { void x; }", 2451},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			ds := program.GetSemanticDiagnostics(t.Context(), file)
			if tc.code == 0 {
				if len(ds) != 0 {
					t.Fatalf("separate source-body home rejected: %v", ds)
				}
				return
			}
			found := false
			for _, d := range ds {
				if d.Code() == 4703 {
					t.Errorf("unsupported home: %v", d)
				}
				found = found || d.Code() == tc.code
			}
			if !found {
				t.Fatalf("missing TS%d: %v", tc.code, ds)
			}
		})
	}
}
