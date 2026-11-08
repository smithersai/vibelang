/** @type {string[]} */
exports.events = []
/**
 * @param {string} value
 * @returns {number}
 * @throws {never}
 */
exports.safe = function(value) { return value.length }

/**
 * @param {string} value
 * @returns {number}
 * @throws {RangeError}
 */
exports.risky = function(value) {
  exports.events.push("call:" + value)
  if (!value) throw new RangeError("empty")
  return value.length
}
