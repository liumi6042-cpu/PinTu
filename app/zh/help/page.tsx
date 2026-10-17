import AccountGate from '@/app/account-gate';
import ServiceDocument from '@/app/service-document';
import { zhPageMetadata } from '@/lib/seo';
import ChineseIntroduction from '../chinese-introduction';
export const metadata = zhPageMetadata('/help');
export default function Page(){return <><AccountGate><ServiceDocument kind="help"/></AccountGate>
 <section className="community-main help-upload">
  <div className="help-upload-card">
   <div><h2>用我的图片开一桌</h2><p>上传一张图片，选好片数，直接开一张自己的拼图桌。图片只在房间有效期内保留，房间结束后不再长期保存。</p><small>仅网页版提供；小程序暂不支持上传图片。</small></div>
   <a className="primary" href="/zh/upload">上传图片开桌 →</a>
  </div>
 </section>
 <ChineseIntroduction kind="help"/></>;}
