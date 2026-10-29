; inherits: typescript

; VibeLang's tokens. These queries live in queries/vibe/ so that Neovim finds
; them on its runtimepath; it reads the inherits line above and applies these
; patterns after TypeScript's, so they win. tree-sitter.json lists this file
; before TypeScript's and JavaScript's, where the first match wins. The groups
; follow editors/vscode/scripts/vibelang-grammar.mjs: declarations color like
; class, handle and catch like try, fork, join, and await operations like
; await, match and when like switch and case, and is, and, or, and not like
; instanceof.

; Declarations (D126, D128, D133, D221, D223, D307)
[
  "error"
  "service"
  "control"
  "schema"
  "data"
  "layer"
] @keyword.type

; A data declaration's variants (D307), as TypeScript colors enum members.
(data_variant
  name: (property_identifier) @constant)

(service_declaration
  "class" @keyword.modifier)

(control_declaration
  "class" @keyword.modifier)

; Module declarations (D283): module as TypeScript colors its module keyword,
; and the name and an identifier module specifier as module names. The body
; is TypeScript's statement_block, colored by the inherited queries.
(module_declaration
  "module" @keyword
  name: (identifier) @module)

(import_statement
  source: (identifier) @module)

(export_statement
  source: (identifier) @module)

(layer_declaration
  service: (identifier) @type)

(layer_value
  "readonly" @keyword.modifier)

; Members are readonly unless written mutable (D134).
"mutable" @keyword.modifier

; Effect types: Result!Error!Dependencies (D127).
(effect_type
  "!" @operator)

; provide Layer { ... } (VIP-12).
(provide_statement
  "provide" @keyword)

; Handlers and catch expressions (D132, D236).
(handle_clause
  "handle" @keyword.exception)

(handle_clause
  operation: (nested_identifier
    property: (property_identifier) @function.method))

(catch_expression
  "catch" @keyword.exception)

; Throw and do expressions (D186, D187), colored as TypeScript colors throw
; and do.
(throw_expression
  "throw" @keyword.exception)

(do_expression
  "do" @keyword.repeat)

(finally_clause
  parameter: (identifier) @variable.parameter)

; The boundary hatch try(...) (D148).
(call_expression
  function: (identifier) @keyword.exception
  (#eq? @keyword.exception "try"))

; Fibers (D166, D169, D196, D225).
[
  "fork"
  "join"
] @keyword.coroutine

(await_expression
  [
    "all"
    "allSettled"
    "race"
    "any"
  ] @keyword.coroutine)

(for_in_statement
  "concurrent" @keyword.repeat)

; Pipes (D154).
"|>" @operator

(topic_reference) @operator

; Pattern matching (D206-D225).
(match_expression
  "match" @keyword.conditional)

(match_arm
  [
    "when"
    "default"
  ] @keyword.conditional)

(is_expression
  "is" @keyword.operator)

(combined_pattern
  operator: _ @keyword.operator)

(not_pattern
  "not" @keyword.operator)

(binding_pattern
  name: (identifier) @variable)

(extractor_pattern
  extractor: (identifier) @type)

(variant_pattern
  variant: (member_expression
    property: (property_identifier) @constant))

(extractor_pattern
  extractor: (member_expression
    property: (property_identifier) @type))
