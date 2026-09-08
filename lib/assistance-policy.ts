// No provider is connected. Only a future server-verified ad reward may grant access.
export const ADS_AVAILABLE=false;
export const ASSISTANCE_POLICY={
 hint:{title:'提示',maxPerGame:3,durationSeconds:null,description:'每局每人最多使用 3 次。后续每次完整观看广告，可获得一次位置提示。'},
 reference:{title:'原图',maxPerGame:null,durationSeconds:30,description:'使用次数不限。后续每次完整观看广告，可查看原图 30 秒，到时自动收起。'},
 underlay:{title:'底图',maxPerGame:null,durationSeconds:30,description:'后续每次完整观看广告，可显示底图 30 秒，到时自动收起。'}
} as const;
export type AssistanceKind=keyof typeof ASSISTANCE_POLICY;
