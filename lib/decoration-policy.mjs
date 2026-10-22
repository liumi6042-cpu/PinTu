// Keep these identities and historical ownership intact while their artwork is retired.
// This is a code policy, not a new field in the public game-settings schema.
export const RETIRED_DECORATION_IDS=Object.freeze(['berry-spark','honey-star']);
export const isRetiredDecoration=id=>RETIRED_DECORATION_IDS.includes(id);
export const availableDecorationId=id=>id&&!isRetiredDecoration(id)?id:null;
