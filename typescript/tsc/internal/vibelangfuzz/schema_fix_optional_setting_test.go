package vibelangfuzz

// schemaOptionalWrappers are the field codecs the target writes around a
// primitive P, by key, with whether EK4832's fix writes a struct of them
// (fixed) and whether EK4837's fix writes a schema error of them (fixedError:
// 1 yes, -1 no, 0 either, checked only for declaration identity). A
// Schema.optional(S) field has the spelling name?: T | undefined; a
// Schema.optionalKey field has none. An optional codec with its own
// undefined arm keeps a struct constant, while a schema error may name it by
// a constant, which the written undefined arm leaves as it is.
var schemaOptionalWrappers = []struct {
	key        string
	wrap       func(p string) string
	fixed      bool
	fixedError int
}{
	{"required", func(p string) string { return p }, true, 1},
	{"optional", func(p string) string { return "Schema.optional(" + p + ")" }, true, 1},
	{"mutable-optional", func(p string) string { return "Schema.mutableKey(Schema.optional(" + p + "))" }, true, 0},
	{"optional-union-null", func(p string) string { return "Schema.optional(Schema.Union([" + p + ", Schema.Null]))" }, true, 1},
	{"optional-nested", func(p string) string { return "Schema.optional(Schema.Struct({ inner: Schema.optional(" + p + ") }))" }, true, 1},
	{"optional-array", func(p string) string { return "Schema.optional(Schema.Array(" + p + "))" }, true, 1},
	{"optionalKey", func(p string) string { return "Schema.optionalKey(" + p + ")" }, false, -1},
	{"optional-undefined", func(p string) string { return "Schema.optional(Schema.Undefined)" }, false, 0},
	{"optional-union-undefined", func(p string) string { return "Schema.optional(Schema.Union([" + p + ", Schema.Undefined]))" }, false, 0},
}
