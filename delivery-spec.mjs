// Canonical image sizing rule for every delivery path.
//
// It lives with the build so the release check and the admin agree by
// construction; this file re-exports it so the admin keeps one definition.
export {
  MAX_DELIVERY_PIXELS,
  deliveryDimensions,
} from '../work/dual-managed-release-20261014/scripts/delivery-spec.mjs';
