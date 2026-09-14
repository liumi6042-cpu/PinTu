import { notFound,permanentRedirect } from 'next/navigation';
import { PHOTOS,latestPublishedPhoto } from '@/lib/puzzle-catalog';
import { maximumPieces } from '@/lib/piece-policy';
import { englishCopy, jsonLd, publicMetadata, puzzlePath, SITE_URL } from '@/lib/seo';
import PuzzleIntroduction from '../../puzzle-introduction';
export async function generateMetadata({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,photo=PHOTOS.find(p=>p.id===id);
  if(!photo)return {title:'Puzzle not found | Jigsaw Nook',robots:{index:false,follow:false}};
  const title=englishCopy(photo.title);
  return publicMetadata(puzzlePath(id),`${title} — Free Online Jigsaw Puzzle`,`${englishCopy(photo.subtitle)} Play the ${title} jigsaw online with 108–${maximumPieces(id).toLocaleString('en-US')} pieces in a free public table with friends.`,photo.thumbSrc);
}
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params,photo=PHOTOS.find(p=>p.id===id);
  if(!photo){const replacement=latestPublishedPhoto(id);if(replacement)permanentRedirect(puzzlePath(replacement.id));notFound();}
  const title=englishCopy(photo.title),url=SITE_URL+puzzlePath(id);
  const data={'@context':'https://schema.org','@graph':[
    {'@type':'WebPage','@id':url,url,name:`${title} Jigsaw Puzzle`,description:englishCopy(photo.subtitle),inLanguage:'en',isPartOf:{'@id':SITE_URL+'/'},primaryImageOfPage:{'@type':'ImageObject',contentUrl:SITE_URL+photo.thumbSrc,caption:title}},
    {'@type':'BreadcrumbList',itemListElement:[{ '@type':'ListItem',position:1,name:'Home',item:SITE_URL+'/'},{'@type':'ListItem',position:2,name:'Puzzle gallery',item:SITE_URL+'/gallery'},{'@type':'ListItem',position:3,name:title,item:url}]}
  ]};
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(data)}}/><PuzzleIntroduction photo={photo}/></>;
}
