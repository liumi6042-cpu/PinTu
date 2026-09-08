import type { RoomVisibility } from './room-engine';
export type RoomCard={id:string;title:string;imageId:string;pieces:number;visibility:RoomVisibility;players:number;placed:number;elapsed:number;started:boolean;startedAt:number|null;completed:boolean;expiresAt:number};
export type RankingRow={roomId:string;elapsedMs:number;completedAt:number;playerCount:number;names:string[]};
