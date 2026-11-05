import {identityHash} from "./diagnostic-identity-renames.mjs"

// The checkpoint belongs to the allocation transition, whose prior hashes
// remain independently recorded. Later compiler changes have their own tests.
export function allocationPreservesChecker(capture, reference) {
 if(capture.path!==reference.path || capture.base!==reference.base ||
    capture.normalizedSha256!==reference.normalizedSha256 ||
    !Array.isArray(capture.segments) || capture.segments.length===0) return false
 return capture.segments.every(segment=>typeof segment.before==="string" &&
  typeof segment.after==="string" &&
  identityHash(segment.before,capture.path)===identityHash(segment.after,capture.path))
}
