import AccountGate from '@/app/account-gate';
import ServiceDocument from '@/app/service-document';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/help');
export default function Page(){return <><AccountGate><ServiceDocument kind="help"/></AccountGate>
 <section className="community-main help-upload">
  <div className="help-upload-card">
   <div><h2>Start a table with your own picture</h2><p>Upload a picture, pick a piece count and open your own table. The picture is kept only while the room is alive.</p><small>Uploading is available on the web.</small></div>
   <a className="primary" href="/upload">Upload a picture →</a>
  </div>
 </section></>;}
