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
  if (!value) throw new RangeError("empty")
  return value.length
}
