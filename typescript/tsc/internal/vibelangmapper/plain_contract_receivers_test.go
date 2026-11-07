package vibelangmapper

import (
	"strings"
	"testing"
)

func TestPlainContractOrdinaryCapitalizedReceivers(t *testing.T) {
	for _, source := range []string{
		"const Box={key():\"field\"{return \"field\"}};export function f():string{return Box.key()}",
		"const Box={key:():string=>\"field\"};export function f():string{return Box.key()}",
		"const Box={value:\"field\",key():string{return this.value}};export function f():string{return Box.key()}",
		"class Box {static key():string{return \"field\"}};export function f():string{return Box.key()}",
		"const Box=():string=>\"field\";export function f():string{return Box()}",
		"function Box():string{return \"field\"};export function f():string{return Box()}",
		"export function f(Box:{key():string}):string{return Box.key()}",
		"export function f():string{const Box={key():string{return \"field\"}};return Box.key()}",
		"service Box {read():string};export function f(Box:{key():string}):string{return Box.key()}",
		"const Box={key():string{return \"outer\"}};export function f():string{const Box={key():string{return \"inner\"}};return Box.key()}",
	} {
		for _, text := range []string{source, strings.ReplaceAll(source, "Box", "box")} {
			t.Run(text, func(t *testing.T) { assertPlainContractDiagnostic(t, text, false) })
		}
	}
}

func TestPlainContractKnownServiceAndEffectReceivers(t *testing.T) {
	for _, source := range []string{
		"service Store {read():string};export function f():string{return Store.read()}",
		"service Store {read():string};export function f():string{return Store()}",
		"export function f():string{service Store {static readonly key=\"method/Store\";read():string};return Store.read()}",
		"export function f():string{{service Store {static readonly key=\"block/Store\";read():string};return Store.read()}}",
		"export function f():number{Effect.succeed(1);return 1}",
		"import {Console as Output}from \"effect\";export function f():number{Output.log(\"value\");return 1}",
	} {
		t.Run(source, func(t *testing.T) { assertPlainContractDiagnostic(t, source, true) })
	}
}
