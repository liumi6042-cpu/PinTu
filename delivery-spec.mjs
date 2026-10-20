// Kept as the admin's public entry point so callers do not care where the
// rule lives. The authoritative copy is content-admin/contracts/delivery-spec.mjs;
// the Web build tree keeps a mirrored copy that a test compares against.
export {MAX_DELIVERY_PIXELS, deliveryDimensions} from './contracts/delivery-spec.mjs';
