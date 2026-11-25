import SharedGame from '../shared-game';
import build from '../shared-client-build.json';
export const metadata={title:'拼图小窝 · 测试版',robots:{index:false,follow:false}};
export default function Page(){return <><link rel="preload" href={build.script} as="script"/><SharedGame/></>;}
