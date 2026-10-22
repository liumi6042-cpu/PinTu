import type {ReactNode} from 'react';
import {mobileSymbolPaths} from './mobile-symbol-paths';

export const conceptSymbols=Object.fromEntries(Object.entries(mobileSymbolPaths).map(([name,paths])=>[name,<>{paths.map((path,index)=><path key={index} d={path.d} fillRule={'fillRule' in path?path.fillRule:undefined}/>)}</>])) as Record<keyof typeof mobileSymbolPaths,ReactNode>;
