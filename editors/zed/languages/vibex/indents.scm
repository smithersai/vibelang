[
  (statement_block)
  (object)
  (object_type)
  (array)
  (arguments)
  (formal_parameters)
  (parenthesized_expression)
  (class_body)
  (interface_body)
  (enum_body)
  (switch_body)
  (match_body)
  (object_match_pattern)
  (array_match_pattern)
  (template_substitution)
] @indent

[
  "}"
  "]"
  ")"
] @outdent

(jsx_element
  (jsx_opening_element) @indent
  (jsx_closing_element) @outdent)
