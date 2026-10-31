package vibelang

import "testing"

// Details214/240 require the owning diagnostic without moving evaluation.
func TestUnsettledIsBindingHomes(t *testing.T) {
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
