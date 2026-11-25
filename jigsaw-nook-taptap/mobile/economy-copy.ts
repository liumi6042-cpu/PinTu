import type {MobileProfile} from '../h5/mobile-api';

export function upgradeCopy(profile?:MobileProfile|null){
 const mode=profile?.economy?.upgradeRefill??'full';
 return mode==='full'?'升级时补满体力':mode==='fixed'?'每升一级获得 '+(profile?.economy?.upgradeEnergy??0)+' 点体力':'升级时不额外补充体力';
}
export function contributionCopy(profile?:MobileProfile|null){
 return '每次有效拼合消耗 '+(profile?.economy?.contributionCost??1)+' 点体力，获得 '+(profile?.economy?.contributionXp??1)+' 经验。'+upgradeCopy(profile)+'。每 10 次有效拼合存入一份小礼包，完成拼图按贡献获得奖励。';
}
export function recoveryCopy(profile?:MobileProfile|null){
 const minutes=profile?.economy?.naturalRecoveryMinutes??5;
 return minutes>0?'体力每 '+minutes+' 分钟自然恢复 1 点，最多恢复到当前上限。':'当前关闭体力自然恢复。';
}
