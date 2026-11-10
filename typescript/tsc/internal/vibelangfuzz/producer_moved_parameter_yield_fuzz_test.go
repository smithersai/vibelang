package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const movedProducerYieldQuote = "Forbidden `await` in directly evaluated formal-parameter initialization of an Effect callable or producer is `EK0102`; forbidden `yield` there is `EK2104`."
const movedProducerYieldBoundaryQuote = "Stop at a nested source callable or context boundary; an ordinary async callable or native generator keeps its own `await` or `yield` rules."

func TestProducerMovedParameterYieldQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", movedProducerYieldQuote)
	chapterSays(t, "001-functions.md", movedProducerYieldBoundaryQuote)
}

type producerParameterYieldRule struct {
	key, source string
	codes       []int32
}

func producerParameterYieldRules() []producerParameterYieldRule {
	var rules []producerParameterYieldRule
	for _, head := range []struct{ key, source string }{
		{"heritage", "class extends (KEY) {}"},
		{"class-method", "class { [KEY]() {} }"},
		{"class-field", "class { [KEY] = 1 }"},
		{"class-getter", "class { get [KEY]() {return 1} }"},
		{"class-setter", "class { set [KEY](value:number) {} }"},
		{"object-method", "{ [KEY]() {} }"},
		{"object-getter", "{ get [KEY]() {return 1} }"},
		{"object-setter", "{ set [KEY](value:number) {} }"},
		{"class-decorator", "@(KEY) class {}"},
		{"method-decorator", "class { @(KEY) read() {} }"},
		{"field-decorator", "class { @(KEY) value=1 }"},
		{"getter-decorator", "class { @(KEY) get read(){return 1} }"},
		{"setter-decorator", "class { @(KEY) set read(value:number){} }"},
	} {
		for _, home := range producerParameterYieldHomes() {
			for _, shape := range []string{"direct", "moved", "direct-do", "moved-do"} {
				for _, operand := range []struct{ key, value string }{{"number", "1"}, {"any", "(undefined as any)"}, {"missing", "missingOperand"}} {
					cast := "string"
					if head.key == "heritage" || strings.Contains(head.key, "decorator") {
						cast = "any"
					} else if head.key == "class-field" {
						cast = "\"read\""
					}
					value := "yield " + operand.value
					if strings.HasSuffix(shape, "-do") {
						value = "do {yield " + operand.value + "; undefined as unknown}"
					}
					key := "((" + value + ") as unknown as " + cast + ")"
					parameter := "value=" + strings.ReplaceAll(head.source, "KEY", key)
					if strings.HasPrefix(shape, "moved") {
						parameter = "early=do {if(false)return;0}, " + parameter
					}
					codes := []int32{2104}
					if head.key == "class-field" {
						codes = append(codes, 1166)
					}
					if operand.key == "missing" {
						codes = append(codes, 2304)
					}
					rules = append(rules, producerParameterYieldRule{head.key + ":" + home.key + ":" + shape + ":" + operand.key, fmt.Sprintf(home.source, parameter), codes})
				}
			}
		}
	}
	for _, home := range producerParameterYieldHomes() {
		for _, control := range []struct{ key, source string }{{"native-generator", "class { *read(){yield 1} }"}, {"native-field-generator", "class { value=(function*(){yield 1})() }"}, {"no-suspension", "class { [\"read\"](){} }"}} {
			rules = append(rules, producerParameterYieldRule{control.key + ":" + home.key, fmt.Sprintf(home.source, "early=do {if(false)return;0}, value="+control.source), nil})
		}
	}
	return rules
}
func producerParameterYieldHomes() []struct{ key, source string } {
	return []struct{ key, source string }{
		{"declaration", "export effect function* read(%s) {yield 0}"},
		{"expression", "export const read=effect function*(%s) {yield 0}"},
		{"class", "export class Home {effect *read(%s) {yield 0}}"},
		{"object", "export const home={effect *read(%s) {yield 0}}"},
	}
}

func FuzzProducerMovedParameterYield(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", movedProducerYieldQuote)
	chapterSays(f, "001-functions.md", movedProducerYieldBoundaryQuote)
	rules := producerParameterYieldRules()
	keys := make([]string, len(rules))
	for i, r := range rules {
		keys[i] = r.key
		f.Add([]byte(r.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, _ := keyedChoice(keys, data)
		rule := rules[i]
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": rule.source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var got []int32
		identity := true
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got = append(got, d.Code())
				if d.Code() == 2104 && !IsEK(d) {
					identity = false
				}
			}
		}
		slices.Sort(got)
		want := slices.Clone(rule.codes)
		slices.Sort(want)
		if !identity || !slices.Equal(got, want) {
			Gap(t, "FuzzProducerMovedParameterYield", rule.key, "%s\n%s\nwant %v got %v\n%s", movedProducerYieldQuote, movedProducerYieldBoundaryQuote, want, got, rule.source)
		}
	})
}
