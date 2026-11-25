import type { RoomVisibility } from './room-engine';
export type RoomCard={customImage?:import('./custom-images').CustomImage;customTitle?:boolean;acceptingNew?:boolean;lastPlayedAt?:number;id:string;title:string;imageId:string;pieces:number;visibility:RoomVisibility;players:number;maxPlayers?:number;placed:number;elapsed:number;started:boolean;startedAt:number|null;completed:boolean;expiresAt:number};
export type RankingRow={roomId:string;elapsedMs:number;completedAt:number;playerCount:number;names:string[];rank?:number;mine?:boolean};
export type RankingBoard={entries:RankingRow[];myBest:RankingRow|null;total:number;period:'all'|'week';weekStart:number;weekEnd:number;hasIdentity:boolean};
