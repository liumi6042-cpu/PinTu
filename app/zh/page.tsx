import HomeExperience from '@/app/home-experience';
import DailyPuzzle from '@/app/daily-puzzle';
import ServiceFooter from '@/app/service-footer';
import { jsonLd,zhPageMetadata,SITE_URL } from '@/lib/seo';
import ChineseIntroduction from './chinese-introduction';
export const metadata = zhPageMetadata('/');
export default function Page() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd({'@context':'https://schema.org','@type':'WebSite','@id':SITE_URL+'/zh',name:'一起拼图',alternateName:'Jigsaw Nook',url:SITE_URL+'/zh',inLanguage:'zh-CN'})}}/>
    <HomeExperience daily={<DailyPuzzle locale="zh"/>} footer={false}/>
    <ChineseIntroduction kind="home"/>
    <ServiceFooter/>
  </>;
}
