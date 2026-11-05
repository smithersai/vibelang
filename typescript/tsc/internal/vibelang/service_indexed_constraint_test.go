package vibelang

import (
	"strings"
	"testing"
)

func TestServiceIndexedConstraint(t *testing.T) {
	for _, tc := range []struct{ name, operation, source string }{
		{"direct-instanceof", "instanceof", "export function test<Box extends {key:typeof S}>(key:Box[\"key\"],value:unknown){return value instanceof key}"},
		{"direct-pattern", "pattern", "export function test<Box extends {key:typeof S}>(key:Box[\"key\"],value:unknown){return match(value){when key:1;default:0;}}"},
		{"direct-extractor", "extractor", "export function test<Box extends {key:typeof S}>(key:Box[\"key\"],value:unknown){return match(value){when key():1;default:0;}}"},
		{"named-instanceof", "instanceof", "type Selected<Box extends {key:typeof S}>=Box[\"key\"];export function test<Box extends {key:typeof S}>(key:Selected<Box>,value:unknown){return value instanceof key}"},
		{"named-pattern", "pattern", "type Selected<Box extends {key:typeof S}>=Box[\"key\"];export function test<Box extends {key:typeof S}>(key:Selected<Box>,value:unknown){return match(value){when key:1;default:0;}}"},
		{"named-extractor", "extractor", "type Selected<Box extends {key:typeof S}>=Box[\"key\"];export function test<Box extends {key:typeof S}>(key:Selected<Box>,value:unknown){return match(value){when key():1;default:0;}}"},
		{"generic-key-instanceof", "instanceof", "export function test<Name extends PropertyKey, Box extends Record<Name,typeof S>>(key:Box[Name],value:unknown){return value instanceof key}"},
		{"generic-key-pattern", "pattern", "export function test<Name extends PropertyKey, Box extends Record<Name,typeof S>>(key:Box[Name],value:unknown){return match(value){when key:1;default:0;}}"},
		{"generic-key-extractor", "extractor", "export function test<Name extends PropertyKey, Box extends Record<Name,typeof S>>(key:Box[Name],value:unknown){return match(value){when key():1;default:0;}}"},
		{"tuple-instanceof", "instanceof", "export function test<Keys extends readonly [typeof S]>(key:Keys[0],value:unknown){return value instanceof key}"},
		{"tuple-pattern", "pattern", "export function test<Keys extends readonly [typeof S]>(key:Keys[0],value:unknown){return match(value){when key:1;default:0;}}"},
		{"tuple-extractor", "extractor", "export function test<Keys extends readonly [typeof S]>(key:Keys[0],value:unknown){return match(value){when key():1;default:0;}}"},
		{"array-instanceof", "instanceof", "export function test<Keys extends ReadonlyArray<typeof S>>(key:Keys[number],value:unknown){return value instanceof key}"},
		{"array-pattern", "pattern", "export function test<Keys extends ReadonlyArray<typeof S>>(key:Keys[number],value:unknown){return match(value){when key:1;default:0;}}"},
		{"array-extractor", "extractor", "export function test<Keys extends ReadonlyArray<typeof S>>(key:Keys[number],value:unknown){return match(value){when key():1;default:0;}}"},
		{"nested-instanceof", "instanceof", "export function test<Box extends {inner:{key:typeof S}}>(key:Box[\"inner\"][\"key\"],value:unknown){return value instanceof key}"},
		{"nested-pattern", "pattern", "export function test<Box extends {inner:{key:typeof S}}>(key:Box[\"inner\"][\"key\"],value:unknown){return match(value){when key:1;default:0;}}"},
		{"nested-extractor", "extractor", "export function test<Box extends {inner:{key:typeof S}}>(key:Box[\"inner\"][\"key\"],value:unknown){return match(value){when key():1;default:0;}}"},
		{"index-signature-instanceof", "instanceof", "export function test<Box extends Record<string,typeof S>>(key:Box[string],value:unknown){return value instanceof key}"},
		{"index-signature-pattern", "pattern", "export function test<Box extends Record<string,typeof S>>(key:Box[string],value:unknown){return match(value){when key:1;default:0;}}"},
		{"index-signature-extractor", "extractor", "export function test<Box extends Record<string,typeof S>>(key:Box[string],value:unknown){return match(value){when key():1;default:0;}}"},
		{"property-instanceof", "instanceof", "export function test<Box extends {key:typeof S}>(key:{key:Box[\"key\"]},value:unknown){return value instanceof key.key}"},
		{"property-pattern", "pattern", "export function test<Box extends {key:typeof S}>(key:{key:Box[\"key\"]},value:unknown){return match(value){when key.key:1;default:0;}}"},
		{"property-extractor", "extractor", "export function test<Box extends {key:typeof S}>(key:{key:Box[\"key\"]},value:unknown){return match(value){when key.key():1;default:0;}}"},
		{"class-owner-instanceof", "instanceof", "export class Host<Box extends {key:typeof S}> {test(key:Box[\"key\"],value:unknown){return value instanceof key}}"},
		{"class-owner-pattern", "pattern", "export class Host<Box extends {key:typeof S}> {test(key:Box[\"key\"],value:unknown){return match(value){when key:1;default:0;}}}"},
		{"class-owner-extractor", "extractor", "export class Host<Box extends {key:typeof S}> {test(key:Box[\"key\"],value:unknown){return match(value){when key():1;default:0;}}}"},
	} {
		for _, whole := range []bool{false, true} {
			form := "body"
			prefix := "service S {static readonly key=\"indexed/S\";value:number};"
			if whole {
				form = "whole"
				prefix = "service S: {value:number} {static readonly key=\"indexed/S\"};"
			}
			t.Run(tc.name+"/"+form, func(t *testing.T) { serviceCaptureRecoveryErrors(t, prefix+tc.source, map[int32]int{3004: 1}) })
		}
		for _, whole := range []bool{false, true} {
			form := "body"
			prefix := "service S {static readonly key=\"indexed/Identifier\";value:number};"
			if whole {
				form = "whole"
				prefix = "service S: {value:number} {static readonly key=\"indexed/Identifier\"};"
			}
			bound := "S & {new():object}"
			if tc.operation == "extractor" {
				bound = "S & ((value:unknown)=>unknown[])"
			}
			t.Run(tc.name+"/identifier/"+form, func(t *testing.T) {
				serviceCaptureRecoveryErrors(t, prefix+strings.ReplaceAll(tc.source, "typeof S", bound), map[int32]int{})
			})
		}

		t.Run(tc.name+"/native", func(t *testing.T) {
			want := map[int32]int{}
			if tc.operation == "extractor" {
				want[704] = 1
			}
			serviceCaptureRecoveryErrors(t, "class S {}"+tc.source, want)
		})
		if tc.operation == "extractor" {
			t.Run(tc.name+"/callable", func(t *testing.T) {
				serviceCaptureRecoveryErrors(t, "function S(_v:unknown):unknown[]{return []};"+tc.source, map[int32]int{})
			})
		}
	}
}

func TestServiceIndexedConstraintConstruction(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		code         int32
	}{
		{"new", "export function test<Box extends {key:typeof S}>(key:Box[\"key\"]){return new key()}", 3003},
		{"extends", "export function test<Box extends {key:typeof S}>(key:Box[\"key\"]){class Child extends key {};return Child}", 3002},
	} {
		for _, prefix := range []string{"service S {static readonly key=\"indexed/Construct\";value:number};", "service S: {value:number} {static readonly key=\"indexed/Construct\"};"} {
			t.Run(tc.name+prefix, func(t *testing.T) { serviceCaptureRecoveryErrors(t, prefix+tc.source, map[int32]int{tc.code: 1}) })
		}
	}
}
