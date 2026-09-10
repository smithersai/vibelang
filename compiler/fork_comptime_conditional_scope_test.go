package compiler

import "testing"

func TestPinnedForkComptimeConditionalScope(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"shadow does not leak", `const value=40; let total=0;
if (const value=2; value===2) {total=value} else {total=100}
return total+value`, "42"},
		{"else-if sees and mutates the same header binding", `let total=0;
if (let value=1; false) {total=100} else if (value===1) {value+=1;total=value} else {total=200}
return total`, "2"},
		{"nested scopes restore the containing header", `let total=0;
if (const value=2; value>0) {if (const value=3; value>0) {total=value} total+=value}
return total`, "5"},
		{"initializer runs once before condition", `let calls=0;
if (let value=++calls; value===1) {value+=2;return calls*10+value} else {return 99}`, "13"},
		{"return unwinds the conditional scope", `if (const value=42; value>0) {return value} else {return 0}`, "42"},
		{"continue unwinds before a fresh iteration", `let total=0;
for(let index=0;index<3;index++){if(const value=index;value<2){continue}else{total+=value}}
return total`, "2"},
		{"break unwinds before the enclosing result", `let total=0;
while(true){if(const value=5;value>0){total=value;break}}
return total`, "5"},
		{"declaration list evaluation is left to right", `if (const left=20,right=left+2;right>left){return left+right}else{return 0}`, "42"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {comptime} from "vibelang:comptime"; const computed=comptime(()=>{` + tc.body + `})(); export function main(){return computed}`
			result := compileComptime(t, comptimeSources(source), nil)
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != tc.want {
				t.Fatalf("got %s; want %s", got, tc.want)
			}
		})
	}
	for _, tc := range []struct{ name, body string }{
		{"const cannot be assigned", `if(const value=1;true){value=2;return value}else{return 0}`},
		{"binding does not escape", `if(const value=1;true){} return value`},
		{"self initialization is not an outer read", `const value=40;if(const value=value;true){return value}else{return 0}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {comptime} from "vibelang:comptime"; const computed=comptime(()=>{` + tc.body + `})(); export function main(){return computed}`
			result := compileComptime(t, comptimeSources(source), nil)
			requireComptimeDiagnostic(t, result, comptimeCodeUnsupportedExpression)
		})
	}
}
