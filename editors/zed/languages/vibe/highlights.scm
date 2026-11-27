; Vibe (VibeLang) syntax highlighting queries for Zed.

; Comments
(comment) @comment

; Identifiers & properties
(identifier) @variable
(property_identifier) @property
(shorthand_property_identifier) @property
(shorthand_property_identifier_pattern) @variable

; Types
(type_identifier) @type
(predefined_type) @type.builtin

((identifier) @constant
  (#match? @constant "^[A-Z_][A-Z\d_]+$"))

; Builtin values
[
  (this)
  (super)
] @variable.special

[
  (true)
  (false)
] @boolean

[
  (null)
  (undefined)
] @constant

; Literals
[
  (string)
  (template_string)
] @string

(regex) @string.regex
(number) @number

; Functions & calls
(function_declaration
  name: (identifier) @function)

(method_definition
  name: (property_identifier) @function.method)

(method_signature
  name: (property_identifier) @function.method)

(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: (property_identifier) @function.method))

(new_expression
  constructor: (identifier) @constructor)

(variable_declarator
  name: (identifier) @function
  value: [(arrow_function) (function_expression)])

; Parameters
(required_parameter
  pattern: (identifier) @variable.parameter)

(optional_parameter
  pattern: (identifier) @variable.parameter)

(finally_clause
  parameter: (identifier) @variable.parameter)

; Declarations (Vibe)
[
  "error"
  "service"
  "control"
  "schema"
  "data"
] @keyword

(error_declaration
  name: (type_identifier) @type)

(service_declaration
  name: (type_identifier) @type)

(control_declaration
  name: (type_identifier) @type)

(schema_declaration
  name: (type_identifier) @type)

(data_declaration
  name: (type_identifier) @type)

(data_variant
  name: (property_identifier) @constant)

(module_declaration
  "module" @keyword
  name: (identifier) @type)

(import_statement
  source: (identifier) @type)

(export_statement
  source: (identifier) @type)

"mutable" @keyword

; Effect types & contracts
(effect_type
  "!" @operator)

; Core Vibe keywords & expressions
"effect" @keyword

(provide_statement
  "provide" @keyword)

(try_expression
  "try" @keyword)

(try_expression
  [
    "all"
    "allSettled"
    "race"
    "any"
  ] @keyword)

(catch_expression
  "catch" @keyword)

(handle_clause
  "handle" @keyword)

(handle_clause
  operation: (nested_identifier
    property: (property_identifier) @function.method))

(throw_expression
  "throw" @keyword)

(do_expression
  "do" @keyword)

(call_expression
  function: (identifier) @keyword
  (#eq? @keyword "try"))

; Fibers & concurrency
[
  "fork"
  "join"
] @keyword

(await_expression
  [
    "all"
    "allSettled"
    "race"
    "any"
  ] @keyword)

(for_in_statement
  "concurrent" @keyword)

; Pipes & topic reference
"|>" @operator
(topic_reference) @operator

; Pattern matching
(match_expression
  "match" @keyword)

(match_arm
  [
    "when"
    "default"
  ] @keyword)

(is_expression
  "is" @keyword)

(combined_pattern
  operator: _ @keyword)

(not_pattern
  "not" @keyword)

(binding_pattern
  name: (identifier) @variable)

(extractor_pattern
  extractor: (identifier) @type)

(extractor_pattern
  extractor: (member_expression
    property: (property_identifier) @type))

(variant_pattern
  variant: (member_expression
    property: (property_identifier) @constant))

; Standard TypeScript / JavaScript keywords
[
  "abstract"
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "declare"
  "default"
  "delete"
  "do"
  "else"
  "enum"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "implements"
  "import"
  "in"
  "infer"
  "instanceof"
  "interface"
  "keyof"
  "let"
  "namespace"
  "new"
  "of"
  "override"
  "private"
  "protected"
  "public"
  "readonly"
  "return"
  "satisfies"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "type"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword

; Operators
[
  "="
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "=="
  "==="
  "!="
  "!=="
  "<"
  "<="
  ">"
  ">="
  "&&"
  "||"
  "??"
  "!"
  "&"
  "|"
  "^"
  "~"
  "<<"
  ">>"
  ">>>"
  "+="
  "-="
  "*="
  "/="
  "%="
  "=>"
  "?"
  ":"
] @operator

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  "."
  ";"
] @punctuation.delimiter

(template_substitution
  "${" @punctuation.special
  "}" @punctuation.special) @embedded
