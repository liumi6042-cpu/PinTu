import { gatewayConfig } from './network';
import { showRewardedAd } from './ads';
declare global { interface Window { JigsawH5Ads?: { watch: () => Promise<'completed'|'closed'|'unavailable'|'failed'> } } }
// Reserved integration point. Completion is a platform observation only and
// must never be trusted by a server as proof for granting a paid entitlement.
window.JigsawH5Ads={async watch(){
  if(!navigator.userActivation?.isActive)return 'unavailable';
  try{const config=await gatewayConfig();return config.rewardedAdUnitId?showRewardedAd(config.rewardedAdUnitId):'unavailable';}
  catch{return 'failed';}
}};