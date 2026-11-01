package tsoptions

import (
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestMergeCompilerOptions(t *testing.T) {
	t.Parallel()

	if mergeCompilerOptions(nil, nil, nil, "", "") != nil {
		t.Fatal("Merging nil options must return nil")
	}
	unchanged := &core.CompilerOptions{Strict: core.TSTrue}
	if mergeCompilerOptions(unchanged, nil, nil, "", "") != unchanged || unchanged.Strict != core.TSTrue {
		t.Fatal("A nil source must leave the target unchanged")
	}

	for field := range reflect.TypeFor[core.CompilerOptions]().Fields() {
		if !field.IsExported() {
			continue
		}
		if field.Name == "Effect" {
			continue // derived from the @effect/language-service plugin, not an option of its own (effect-tsgo, VIP-38)
		}
		t.Run(field.Name, func(t *testing.T) {
			t.Parallel()
			name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			nullOptions := &collections.OrderedMap[string, any]{}
			nullOptions.Set(name, nil)
			raw := &collections.OrderedMap[string, any]{}
			raw.Set("compilerOptions", nullOptions)
			values := compilerOptionTestValues(t, field)
			for _, targetValue := range values {
				for _, sourceValue := range values {
					for _, explicitNull := range []bool{false, true} {
						target := &core.CompilerOptions{}
						source := &core.CompilerOptions{}
						reflect.ValueOf(target).Elem().FieldByIndex(field.Index).Set(targetValue)
						reflect.ValueOf(source).Elem().FieldByIndex(field.Index).Set(sourceValue)
						expected := target.Clone()
						expectedField := reflect.ValueOf(expected).Elem().FieldByIndex(field.Index)
						var rawSource any
						if explicitNull {
							rawSource = raw
							expectedField.SetZero()
						} else if !sourceValue.IsZero() {
							expectedField.Set(sourceValue)
						}
						if got := mergeCompilerOptions(target, source, rawSource, "", ""); got != target || !reflect.DeepEqual(got, expected) {
							t.Fatalf("Merge differs for target=%v, source=%v, explicitNull=%v", targetValue, sourceValue, explicitNull)
						}
						actualField := reflect.ValueOf(target).Elem().FieldByIndex(field.Index)
						// VIP-30 merges nested Vibe settings by key and isolates their maps;
						// ordinary compiler-option pointers retain shallow replacement.
						if field.Name != "VibeLang" && (field.Type.Kind() == reflect.Pointer || field.Type.Kind() == reflect.Slice) && actualField.Pointer() != expectedField.Pointer() {
							t.Fatal("Merge must preserve shallow sharing")
						}
						if !reflect.DeepEqual(reflect.ValueOf(source).Elem().FieldByIndex(field.Index).Interface(), sourceValue.Interface()) {
							t.Fatal("Merge must not modify the source")
						}
					}
				}
			}
		})
	}
}

func TestMergeCompilerOptionsRawNulls(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"moduleDetection", "ModuleDetection", "moduleDetectionKind", "unknownOption"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			rawOptions := &collections.OrderedMap[string, any]{}
			rawOptions.Set(name, nil)
			raw := &collections.OrderedMap[string, any]{}
			raw.Set("compilerOptions", rawOptions)
			target := &core.CompilerOptions{ModuleDetection: core.ModuleDetectionKindForce}
			source := &core.CompilerOptions{ModuleDetection: core.ModuleDetectionKindAuto}
			mergeCompilerOptions(target, source, raw, "", "")
			expected := core.ModuleDetectionKindAuto
			if name == "moduleDetection" {
				expected = core.ModuleDetectionKindNone
			}
			if target.ModuleDetection != expected {
				t.Fatalf("Got %v, want %v", target.ModuleDetection, expected)
			}
			mergeCompilerOptions(source, source, raw, "", "")
			if source.ModuleDetection != expected {
				t.Fatal("Merging an object with itself must still apply explicit nulls")
			}
		})
	}
}

func TestParseCompilerOptionNoMissingFields(t *testing.T) {
	t.Parallel()
	var missingKeys []string
	for _, field := range reflect.VisibleFields(reflect.TypeFor[core.CompilerOptions]()) {
		if !field.IsExported() {
			continue
		}
		if field.Name == "Effect" {
			continue // derived from the @effect/language-service plugin, not an option of its own (effect-tsgo, VIP-38)
		}

		keyName := field.Name
		// use the JSON key from the tag, if present
		// e.g. `json:"dog[,anythingelse]"` --> dog
		if jsonTag, ok := field.Tag.Lookup("json"); ok {
			keyName = strings.SplitN(jsonTag, ",", 2)[0]
		}
		val := reflect.Zero(field.Type).Interface()
		co := core.CompilerOptions{}
		found := parseCompilerOptions(keyName, val, &co)
		if !found {
			missingKeys = append(missingKeys, keyName)
		}
	}
	if len(missingKeys) > 0 {
		t.Errorf("The following keys are missing entries in the ParseCompilerOptions"+
			" switch statement:\n%v", missingKeys)
	}
}

func TestMergeVibeSettingsSidecarPathAndMapIsolation(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name, childPath, wantPath string
	}{
		{"inherit", "", "/base/declarations"},
		{"override", "/child/types", "/child/types"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			base := &core.VibeLangOptions{VibeOnly: true, SidecarDir: "/base/declarations", Severities: map[string]string{"EK4802": "warning"}}
			child := &core.VibeLangOptions{VibeOnly: true, SidecarDir: tt.childPath, Severities: map[string]string{"EK4831": "error"}}
			target := &core.CompilerOptions{VibeLang: base}
			source := &core.CompilerOptions{VibeLang: child}
			mergeCompilerOptions(target, source, nil, "", "")
			got := target.VibeLang
			if got.SidecarDir != tt.wantPath || got.Severities["EK4802"] != "warning" || got.Severities["EK4831"] != "error" {
				t.Fatalf("inherited settings differ: %#v", got)
			}
			got.Severities["EK4802"] = "off"
			got.Severities["EK4831"] = "off"
			if base.Severities["EK4802"] != "warning" || child.Severities["EK4831"] != "error" {
				t.Fatal("a merged config must not mutate either extended config's severity map")
			}
			if base.SidecarDir != "/base/declarations" || child.SidecarDir != tt.childPath {
				t.Fatal("merging a sidecar path must not mutate an extended config")
			}
		})
	}
}
