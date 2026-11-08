package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

// Binding defaults and definition-time expressions execute in the producer
// body. Written activations and formal initialization keep their boundaries.
func TestProducerDoYield(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         []int32
	}{
		{"object-default", "effect function* p(){const {n=do {yield 9;7}}={} as {n?:number};yield n}", nil},
		{"object-let", "effect function* p(){let {n=do {yield 9;7}}={} as {n?:number};yield n}", nil},
		{"array-default", "effect function* p(){const [n=do {yield 9;7}]=[] as number[];yield n}", nil},
		{"nested-object", "effect function* p(){const {box:{n=do {yield 9;7}}}={box:{}} as {box:{n?:number}};yield n}", nil},
		{"assignment-default", "effect function* p(){let n:number|undefined;({n=do {yield 9;7}}={} as {n?:number});yield n}", nil},
		{"multiple-defaults", "effect function* p(){const [a=do {yield 9;7},b=do {yield 8;6}]=[] as number[];yield a;yield b}", nil},
		{"present-value", "effect function* p(){const {n=do {yield 9;7}}={n:3};yield n}", nil},
		{"computed-method", "effect function* p(){class C {[do {yield 9;\"m\"}]() {}};yield 0}", nil},
		{"member-decorator", "effect function* p(){class C {@(do {yield 9;((v:unknown,c:unknown)=>{})}) m(){}};yield 0}", nil},
		{"field-decorator", "effect function* p(){class C {@(do {yield 9;((v:unknown,c:unknown)=>{})}) m=1};yield 0}", nil},
		{"class-decorator", "effect function* p(){@(do {yield 9;((v:unknown,c:unknown)=>{})}) class C{};yield 0}", nil},
		{"heritage", "effect function* p(){class C extends do {yield 9;(class {})}{};yield 0}", nil},
		{"object-method", "effect function* p(){const o={[do {yield 9;\"m\"}](){}};yield 0}", nil},
		{"getter", "effect function* p(){class C {get [do {yield 9;\"m\"}](){return 0}};yield 0}", nil},
		{"setter", "effect function* p(){class C {set [do {yield 9;\"m\"}](x:number){}};yield 0}", nil},
		{"static-method", "effect function* p(){class C {static [do {yield 9;\"m\"}](){}};yield 0}", nil},
		{"computed-field", "effect function* p(){class C {[do {yield 9;\"m\" as const}]=1};yield 0}", []int32{1166}},
		{"stream-item", "effect function* p(){for try(const item of Stream.make(0)){const{n=do{yield 9;7}}={} as {n?:number};yield n}}", nil},
		{"concurrent-item", "effect function* p(){for concurrent(1)(const item of [0]){const{n=do{yield 9;7}}={} as {n?:number};yield n}}", nil},
		{"declaration", "effect function* p(){const{n=do{const a=1;yield 9;a+6}}={} as {n?:number};yield n}", nil},
		{"branch", "effect function* p(){const{n=do{if(true){yield 9};7}}={} as {n?:number};yield n}", nil},
		{"loop", "effect function* p(){const{n=do{for(const k of [9]){yield k};7}}={} as {n?:number};yield n}", nil},
		{"yield-value", "effect function* p(){const{n=do{const a=yield 9;a===undefined?7:99}}={} as {n?:number};yield n}", nil},
		{"native-iterator-close", "effect function* p(){const log:number[]=[];function* source(){try{yield undefined}finally{log.push(2)}};const[n=do{log.push(0);yield 9;7}]=source();yield n;yield log.join(\",\")}", nil},
		{"delegation-constraint", "effect function* p(){const{n=do{yield* Stream.make(1);7}}={} as {n?:number};yield n}", []int32{2103}},
		{"nonproducer", "effect function f(){const{n=do{yield 9;7}}={} as {n?:number}}", []int32{2104}},
		{"producer-parameter", "effect function* p(n=do{yield 9;7}){yield n}", []int32{2104}},
		{"native-generator", "function* p(){const{n=do{yield 9;7}}={} as {n?:number};yield n}", []int32{204}},
		{"field-initializer", "effect function* p(){class C{n=do{yield 9;7}};yield 0}", []int32{204}},
		{"static-block", "effect function* p(){class C{static{const{n=do{yield 9;7}}={} as {n?:number}}};yield 0}", []int32{204}},
		{"written-plain-function", "effect function* p(){function f(){const{n=do{yield 9;7}}={} as {n?:number}};yield 0}", []int32{204}},
		{"independent-effect-block", "effect function* p(){const delayed=effect{const{n=do{yield 9;7}}={} as {n?:number}};yield 0}", []int32{2104}},
		{"written-parameter", "effect function* p(){function f(n=do{yield 9;7}){return n};yield 0}", []int32{204}},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			ds := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			var got []int32
			for _, d := range ds {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, test.want) {
				t.Fatalf("want %v got %v in %s", test.want, got, test.source)
			}
		})
	}
}
