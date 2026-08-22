/** Nominal capability base and accessors backed by async-context propagation. */
export {
  Context,
  useCapability,
  useCapability as context,
} from "../poc/dist/runtime/layer.js";
export type {
  CapabilityKey,
  CapabilityService,
} from "../poc/dist/runtime/layer.js";
