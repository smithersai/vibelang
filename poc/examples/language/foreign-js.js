/** @module @throws {never} */
export class JavaScriptFailure extends Error {}

/**
 * @param {string} value
 * @returns {number}
 * @throws {never}
 */
export function trustedJavaScriptLength(value) {
  return value.length
}

/**
 * @param {boolean} fail
 * @returns {string}
 * @throws {JavaScriptFailure}
 */
export function declaredJavaScriptFailure(fail) {
  if (fail) throw new JavaScriptFailure("declared JavaScript failure")
  return "ok"
}

/** @param {string} value */
export async function untrustedJavaScriptAsync(value) {
  return value.toUpperCase()
}

export class JavaScriptAccessFailure extends Error {}

export const javaScriptClient = {
  /** @throws {never} */
  trustedMethod(value) {
    return String(value)
  },
  untrustedMethod(value) {
    return String(value)
  },
  /** @throws {JavaScriptAccessFailure} */
  get dangerousValue() {
    throw new JavaScriptAccessFailure("getter failure")
  },
  /** @throws {never} */
  get safeValue() {
    return "safe"
  },
}

/** @returns {(value: string) => string} */
export function makeJavaScriptCallable() {
  return (value) => value.toUpperCase()
}

/** @param {() => void} callback */
export function receiveJavaScriptCallback(callback) {
  callback()
}


/** @param {{ onValue: () => void }} options */
export function receiveJavaScriptCallbackOptions(options) {
  options.onValue()
}
