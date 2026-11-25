import { gatewayConfig } from './network';
import { showRewardedAd,prepareRewardedAd,disposeRewardedAd } from './ads';
declare global { interface Window { JigsawH5Ads?: { watch: () => Promise<'completed'|'closed'|'unavailable'|'failed'> } } }
// Platform observations are only for nonfinancial puzzle help.
window.JigsawH5Ads={async watch(){
 if(!navigator.userActivation?.isActive)return 'unavailable';
 try{const config=await gatewayConfig();return config.adRewardEnabled&&config.rewardedAdUnitId?showRewardedAd(config.rewardedAdUnitId):'unavailable';}
 catch{return 'failed';}
}};
void gatewayConfig().then(config=>{if(config.adRewardEnabled&&config.rewardedAdUnitId)prepareRewardedAd(config.rewardedAdUnitId);}).catch(()=>{});
window.addEventListener('pagehide',disposeRewardedAd);
