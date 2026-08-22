/** @module @throws {never} */
const { nestedCjs } = require("./common-nested.cjs")

/** @returns {string} */
module.exports = function cjsValue() {
  return `cjs-${nestedCjs()}`
}
