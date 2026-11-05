import { mobileJson, mobilePost, type MobileProfile } from './mobile-api';

export type CollectionImage = {id:string;title:string;src:string;thumbSrc:string;collected:boolean;difficulties:number[];owned?:boolean};
export type CollectionMilestone = {id:string;target:number;coins:number;decorationId?:string;earned:boolean;claimed:boolean;claimable:false};
export type CollectionAlbum = {id:string;title:string;description:string;unlock?:'ad';images:CollectionImage[];collected:number;total:number;milestones:CollectionMilestone[]};
export type CollectionPack = {id:string;title:string;description:string;imageIds:string[];price:number;owned:boolean;unlock?:'ad';unlocked?:number;images:CollectionImage[];coverSrc:string};
export type CollectionDecoration = {id:string;title:string;description:string;cost:number;owned:boolean;equipped:boolean;kind:'cursor';artKey:string;color:string;source:'craft'|'album'|'default'|'gift';albumId?:string;rewardAlbums?:{id:string;title:string;target:number}[];enabled?:boolean};
export type MobileCollectionView = {profile:MobileProfile;wallet:{coins:number;fragments:number};albums:CollectionAlbum[];packs:CollectionPack[];decorations:CollectionDecoration[];equipped:CollectionDecoration|null;tuning?:{contributionCoins:number;completionCoinRatio:number;fragmentContributionStep:number;completionFragmentMinimum:number;completionFragmentMaximum:number;catalogMinimumContributions:number};serverTime:number};
export type CollectionTab = 'albums'|'packs'|'decorations';
export const readCollection=()=>mobileJson<MobileCollectionView>('/api/mobile/collection');
export const buyCollectionPack=(packId:string,requestId:string)=>mobilePost<MobileCollectionView>('/api/mobile/collection/buy',{packId,requestId});
export const craftCollectionDecoration=(decorationId:string,requestId:string)=>mobilePost<MobileCollectionView>('/api/mobile/collection/craft',{decorationId,requestId});
export const equipCollectionDecoration=(decorationId:string|null,requestId:string)=>mobilePost<MobileCollectionView>('/api/mobile/collection/equip',{decorationId,requestId});
