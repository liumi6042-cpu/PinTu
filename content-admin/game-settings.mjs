import {mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {problem} from './store.mjs';
import {DEFAULT_GAME_SETTINGS,validateGameSettings,buildGameConfiguration} from '../jigsaw-nook-taptap/server/game-settings.mjs';

function validateDocument(document){
 try{return validateGameSettings(document);}
 catch(error){throw problem(400,error.message,'INVALID_GAME_SETTINGS');}
}
export function writeGameConfiguration(bridgeDir,document){
 const configuration=buildGameConfiguration(document),bytes=JSON.stringify(configuration,null,2)+'\n';
 mkdirSync(bridgeDir,{recursive:true});const path=join(bridgeDir,'configuration.json');
 try{if(readFileSync(path,'utf8')===bytes)return configuration;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=join(bridgeDir,'.configuration-'+randomUUID()+'.tmp');
 try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,path);}
 finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 return configuration;
}
export function createGameSettingsCoordinator({store,bridgeDir,now=Date.now}){
 store.initializeGameSettings(validateDocument(structuredClone(DEFAULT_GAME_SETTINGS)),now());
 function sync(){const settings=store.gameSettings();writeGameConfiguration(bridgeDir,validateDocument(settings.document));return settings;}
 return {
  sync,
  save(revision,document,actor){
   if(!Number.isSafeInteger(revision)||revision<1)throw problem(400,'游戏设置版本无效','INVALID_GAME_SETTINGS');
   const validated=validateDocument(document),settings=store.saveGameSettings(revision,validated,actor,now());
   try{writeGameConfiguration(bridgeDir,validated);}
   catch{throw problem(503,'设置已保存，但游戏配置暂未更新，请重新载入游戏设置后重试','GAME_SETTINGS_BRIDGE_FAILED');}
   return settings;
  },
 };
}
