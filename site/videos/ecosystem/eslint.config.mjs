import parser from "vibelang/eslint"
export default [{
  files: ["**/*.vibe"],
  languageOptions: { parser },
  rules: { "no-unused-vars": "error" },
}]
