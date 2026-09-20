import { notFound,permanentRedirect } from 'next/navigation';
import { PHOTOS,latestPublishedPhoto } from '@/lib/puzzle-catalog';
import { photoGuidance,recommendedPieces } from '@/lib/play-guidance';
import { maximumPieces } from '@/lib/piece-policy';
import { jsonLd,SITE_URL,zhPuzzleMetadata,zhPath,puzzlePath } from '@/lib/seo';
import ServiceFooter from '@/app/service-footer';
import ChineseNavigation from '../../chinese-navigation';
export async function generateMetadata({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,photo=PHOTOS.find(p=>p.id===id);
  if(!photo)return {title:'这张拼图不存在 | 一起拼图',robots:{index:false,follow:false}};
  return zhPuzzleMetadata(photo);
}
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,photo=PHOTOS.find(p=>p.id===id);
  if(!photo){const replacement=latestPublishedPhoto(id);if(replacement)permanentRedirect(zhPath(puzzlePath(replacement.id)));notFound();}
  const guide=photoGuidance(photo.id),recommended=recommendedPieces(photo.id),maximum=maximumPieces(photo.id).toLocaleString('zh-CN');
  const related=PHOTOS.filter(p=>p.id!==photo.id&&p.category===photo.category).slice(0,3),url=SITE_URL+zhPath(puzzlePath(photo.id));
  const data={'@context':'https://schema.org','@graph':[
    {'@type':'WebPage','@id':url,url,name:`${photo.title}拼图`,description:photo.subtitle,inLanguage:'zh-CN',isPartOf:{'@id':SITE_URL+'/zh'},primaryImageOfPage:{'@type':'ImageObject',contentUrl:SITE_URL+photo.thumbSrc,caption:photo.title}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'首页',item:SITE_URL+'/zh'},{'@type':'ListItem',position:2,name:'图库',item:SITE_URL+'/zh/gallery'},{'@type':'ListItem',position:3,name:photo.title,item:url}]}
  ]};
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(data)}}/><div className="puzzle-introduction-page">
    <ChineseNavigation/>
    <main className="puzzle-introduction">
      <nav className="puzzle-breadcrumbs" aria-label="当前位置"><a href="/zh">首页</a><span>/</span><a href="/zh/gallery">图库</a><span>/</span><span>{photo.title}</span></nav>
      <div className="puzzle-introduction-hero">
        <img src={photo.thumbSrc} alt={photo.title+' — '+photo.subtitle} width={480} height={Math.round(480*guide.height/guide.width)} decoding="async"/>
        <div><p className="section-kicker">{photo.category}</p><h1>{photo.title}拼图</h1><p className="puzzle-introduction-subtitle">{photo.subtitle}</p><p>{guide.reason}</p><p>推荐从 {recommended} 片开始，这张图片最高支持 {maximum} 片。</p>
          <div className="puzzle-introduction-actions"><a className="primary" href={'/zh/gallery?mode=public&image='+photo.id}>创建公开拼图 →</a><a className="secondary" href="/zh/lobby">加入正在拼的房间</a></div>
        </div>
      </div>
      <section className="puzzle-introduction-guide"><h2>从几片开始，慢慢找到节奏</h2><p>先找四角与边缘，再按颜色和形状整理。把拼块拖到邻近位置即可吸附，放大后可以看得更清楚，已拼合的组合可以一起移动。</p><p>这是为一起拼图准备的原创画面。片数越高，每片呈现的原图范围越小；放大不会增加原图中没有的细节。</p><a href="/zh/help">查看存档和多人游玩说明 →</a></section>
      {related.length>0&&<section className="puzzle-related"><h2>再看看这些画面</h2><div>{related.map(p=><a key={p.id} href={zhPath(puzzlePath(p.id))}><img src={p.thumbSrc} alt={p.title} width={480} height={384} loading="lazy" decoding="async"/><span>{p.title}</span></a>)}</div></section>}
    </main><ServiceFooter/>
  </div></>;
}
