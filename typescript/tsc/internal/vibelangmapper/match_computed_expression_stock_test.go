package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestComputedKeyExpressionStock(t *testing.T) {
	for name, source := range map[string]string{
		"is-do-read":    `export function select(s:{value:number}):number{if(s is {[do {"value" as const}]:let value})return value;return 0}`,
		"while-do-read": `export function select(s:{value:number}):number{while(s is {[do {"value" as const}]:let value})return value;return 0}`,

		"source-hygiene": `const $matchKey1Source=21,$matchKey2Source=22,$matchKey3Source=23,$matchKey4Source=24,$matchKey5Source=25,$matchKey6Source=26,$matchKey7Source=27,$matchKey8Source=28;function key():"value"{return "value"};export function select(s:{value:number}):number{if(s is {[do {key()}]:let value})return value+$matchKey2Source;return $matchKey1Source}`,

		"payload":        `function key():"_tag"{return "_tag"};type S={_tag:"A";a:number}|{_tag:"B";b:string};export function select(s:S){return match(s){when {[key()]:"A"}:s.a;when {[key()]:"B"}:s.b;}}`,
		"payload-inline": `function key():"_tag"{return "_tag"};type S={_tag:"A";a:number}|{_tag:"B";b:string};export function select(s:S){return "label"+(match(s){when {[key()]:"A"}:s.a;when {[key()]:"B"}:s.b;})}`,

		"do":            `export function select(s:{value:number}):number{return match(s){when {[do {"value" as const}]:let value}:value;default:0;}}`,
		"await":         `async function key():Promise<"value">{return "value"};export async function select(s:{value:number}):Promise<number>{return match(s){when {[await key()]:let value}:value;default:0;}}`,
		"effect-try":    `effect function key():"value"!!{return "value" as const};export effect function select(s:{value:number}):number!!{return match(s){when {[try key()]:let value}:value;default:0;}}`,
		"hygiene":       `const $matchKey1=11,$matchKey2=12,$matchKey3=13,$matchKey4=14,$matchKey5=15,$matchKey6=16,$matchKey7=17,$matchKey8=18;function key():"value"{return "value"};export function select(s:{value:number}):number{return match(s){when {[key()]:let value}:value+$matchKey1;default:0;}}`,
		"call":          `function key():"value"{return "value"};export function select(s:{value:number}):number{return match(s){when {[key()]:let value}:value;default:0;}}`,
		"overload":      `function key(x:true):"value";function key(x:false):"other";function key(x:boolean):"value"|"other"{return x?"value":"other"};export function select(s:{value:number}):number{return match(s){when {[key(true)]:let value}:value;default:0;}}`,
		"unique-symbol": `declare const token:unique symbol;function key():typeof token{return token};export function select(s:{[token]:number}):number{return match(s){when {[key()]:let value}:value;default:0;}}`,
		"inline":        `function key():"value"{return "value"};export function select(s:{value:number}):number{return 1+match(s){when {[key()]:let value}:value;default:0;}}`,
		"is":            `function key():"value"{return "value"};export function select(s:{value:number}):boolean{return s is {[key()]:let value}}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, output, err := catchTagStock(t, source)
			if err != nil {
				t.Fatalf("computed key lost source type in stock TypeScript: %v\n%s", err, output)
			}
		})
	}
}

func TestComputedKeyExpressionRuntime(t *testing.T) {
	source := `
const $matchKey1=11,$matchKey2=12,$matchKey3=13,$matchKey4=14,$matchKey5=15,$matchKey6=16,$matchKey7=17,$matchKey8=18;
function run():[number,string[]]{
 const log:string[]=[]
 function key():"value"{log.push("key");return "value"}
 const subject={get value():number{log.push("get");return 7}}
 const value=match(subject){when {[key()]:1}:0;when {[key()]:let value}:value;default:-1;}
 return [value+$matchKey1,log]
}
function predicate():[boolean,number,number]{
 let calls=0
 function key():"value"{calls++;return "value"}
 const subject={value:7}
 if(subject is {[key()]:let value})return [true,value,calls]
 return [false,0,calls]
}
console.log(JSON.stringify([run(),predicate()]))
`
	if _, output, err := catchTagStock(t, source); err != nil {
		t.Fatalf("checking runtime witness: %v\n%s", err, output)
	}
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	// Runtime parity emits this view with noCheck; the same source is checked
	// strictly through its checking projection above.
	projection := Executable(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(stock, "--ignoreConfig", "--noCheck", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "--outDir", "out", "main.ts")
	command.Dir = dir
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("executable key projection: %v\n%s", err, output)
	}
	command = exec.Command("node", filepath.Join(dir, "out/main.js"))
	command.Dir = dir
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing computed key projection: %v\n%s", err, output)
	}
	if got, want := strings.TrimSpace(string(output)), `[[18,["key","get","key"]],[true,7,1]]`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestComputedKeyExpressionStockInvalid(t *testing.T) {
	for _, test := range []struct {
		kind  string
		codes []string
	}{
		{"boolean", []string{"2322", "2538"}},
		{"object", []string{"2322", "2538"}},
		{"undefined", []string{"18048", "2538"}},
	} {
		t.Run(test.kind, func(t *testing.T) {
			source := "declare function key():" + test.kind + ";export function select(s:Record<PropertyKey,number>){return match(s){when {[key()]:let value}:value;default:0;}}"
			_, output, err := catchTagStock(t, source)
			if err == nil {
				t.Fatal("invalid computed key passed strict TypeScript")
			}
			matches := regexp.MustCompile(`error TS([0-9]+):`).FindAllStringSubmatch(output, -1)
			codes := make([]string, 0, len(matches))
			for _, match := range matches {
				codes = append(codes, match[1])
			}
			slices.Sort(codes)
			if !slices.Equal(codes, test.codes) {
				t.Errorf("got codes %v, want %v\n%s", codes, test.codes, output)
			}
		})
	}
}
