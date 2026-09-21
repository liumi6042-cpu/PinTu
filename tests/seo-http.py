"""Read-only checks against the built HTTP response; no JavaScript rendering required."""
import argparse,json,re,urllib.request,urllib.error,xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('base');parser.add_argument('--local',action='store_true');args=parser.parse_args()
base=args.base.rstrip('/');origin='https://jigsawnook.online'
class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.metas={};self.canonicals=[];self.titles=[];self.links=[];self.h1=[];self.jsonld=[];self.alternates={};self.kind=None;self.buffer='';self.lang=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='html':self.lang=a.get('lang')
        if tag=='meta':self.metas[a.get('name',a.get('property',''))]=a.get('content','')
        if tag=='link' and a.get('rel')=='canonical':self.canonicals.append(a.get('href'))
        if tag=='link' and a.get('rel')=='alternate' and a.get('hreflang'):self.alternates[a['hreflang']]=a.get('href','')
        if tag=='a':self.links.append(a.get('href',''))
        if tag in ('title','h1') or tag=='script' and a.get('type')=='application/ld+json':self.kind=tag;self.buffer=''
    def handle_data(self,text):
        if self.kind:self.buffer+=text
    def handle_endtag(self,tag):
        if tag==self.kind:
            if tag=='title':self.titles.append(self.buffer)
            if tag=='h1':self.h1.append(self.buffer)
            if tag=='script':self.jsonld.append(json.loads(self.buffer))
            self.kind=None
def get(path):
    headers={'User-Agent':'Mozilla/5.0'}
    if base.startswith('http://127.0.0.1:3113'):headers.update({'Host':'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'})
    try:r=urllib.request.urlopen(urllib.request.Request(base+path,headers=headers),timeout=30)
    except urllib.error.HTTPError as e:r=e
    return r.status,r.headers,r.read().decode('utf-8')
def chinese_path(path):return '/zh' if path=='/' else '/zh'+path
def twin(path,zh):return (origin+(path[3:] or '/')) if zh else origin+chinese_path(path)
norm=lambda u:u.rstrip('/')
status,headers,xml=get('/sitemap.xml');assert status==200
assert 'xml' in headers.get('Content-Type','')
urls=[e.text for e in ET.fromstring(xml).findall('{*}url/{*}loc')]
catalog=json.loads(Path('content/puzzle-catalog.json').read_text(encoding='utf-8'))
# Every published picture is a public page, whichever origin it came from: the
# gallery mixes generated artwork with pictures the operator supplied.
ids=[p['id'] for p in catalog if p['status']=='published' and p['origin'] in ('project-ai-generated','user-provided')]
paths=['/','/lobby','/gallery','/help']+['/puzzle/'+i for i in ids]
# Both languages are published, so the sitemap must list every page twice.
expected={origin+p for p in paths}|{origin+chinese_path(p) for p in paths}
assert set(urls)==expected and len(urls)==len(expected),(len(urls),len(expected))
titles=set();gallery_links={}
for url in urls:
    path=url.removeprefix(origin);zh=path=='/zh' or path.startswith('/zh/')
    status,headers,html=get(path);assert status==200,(path,status)
    page=Page();page.feed(html)
    # The markup a crawler reads without running JavaScript must already declare the
    # language of the page it is on.
    assert page.lang==('zh-CN' if zh else 'en'),(path,page.lang)
    assert len(page.canonicals)==1 and page.canonicals[0].rstrip('/')==url.rstrip('/'),(path,page.canonicals)
    assert len(page.titles)==1 and page.titles[0] not in titles,(path,page.titles)
    titles.add(page.titles[0])
    # Chinese titles exist only on Chinese pages, and only English pages go without.
    assert bool(re.search('[\u3400-\u9fff]',page.titles[0]))==zh,(path,page.titles[0])
    assert len(page.h1)==1 and page.h1[0].strip(),(path,page.h1)
    assert page.metas.get('description') and 'noindex' not in page.metas.get('robots',''),(path,page.metas.get('robots'))
    assert ('noindex' in headers.get('X-Robots-Tag',''))==args.local,(path,headers.get('X-Robots-Tag'))
    assert page.metas.get('og:url','').rstrip('/')==url.rstrip('/') and page.metas.get('og:image','').startswith(origin+'/puzzles/'),path
    assert page.metas.get('og:locale')==('zh_CN' if zh else 'en_US'),(path,page.metas.get('og:locale'))
    # Both copies must publish the same three-way pair, or search engines treat them
    # as unrelated pages competing for the same queries.
    want={'en':url if not zh else twin(path,zh),'zh-CN':twin(path,zh) if not zh else url,'x-default':url if not zh else twin(path,zh)}
    assert {k:norm(v) for k,v in page.alternates.items()}=={k:norm(v) for k,v in want.items()},(path,page.alternates,want)
    if not zh and path=='/':assert any(d.get('@type')=='WebSite' for d in page.jsonld)
    if path in ('/','/zh'):
        # The entrance fills the first screen on its own, so the cards beneath it are
        # reached through this link. Its label has to be in the page's own language in
        # the markup itself — the interface language is English on the server, which
        # once put an English label beside a Chinese picture name — and the anchor has
        # to start above both cards rather than at the picture.
        assert '#today' in page.links,(path,page.links)
        assert 'id="today"' in html,path
        entrance=html.split('id="today"')[0]
        assert ('今天的图' if zh else 'Picture of the day') in entrance,(path,'entrance missing its daily link')
        assert ('Picture of the day' if zh else '今天的图') not in entrance,(path,'entrance label is in the other language')
    if path in ('/gallery','/zh/gallery'):gallery_links[path]=page.links
    if '/puzzle/' in path:
        image_id=path.split('/')[-1]
        assert page.jsonld,path
        created=('' if not zh else '/zh')+'/gallery?mode=public&image='+image_id
        assert created in page.links,(path,created)
for image_id in ids:
    assert '/puzzle/'+image_id in gallery_links['/gallery'],image_id
    # The Chinese gallery must link into the Chinese puzzle pages, not the English ones.
    assert '/zh/puzzle/'+image_id in gallery_links['/zh/gallery'],image_id
for path in ['/account','/personal','/personal/images','/feedback','/membership/manage','/room/00000000000000000000000000000000','/gallery?mode=solo','/gallery?image='+ids[0],'/api/health']:
    status,headers,html=get(path);assert 'noindex' in headers.get('X-Robots-Tag',''),path
for path in ['/puzzle/not-real','/puzzle/skate','/zh/puzzle/not-real']:
    status,headers,html=get(path);assert status==404,(path,status)
    assert 'noindex' in headers.get('X-Robots-Tag','')
status,headers,robots=get('/robots.txt');assert status==200 and origin+'/sitemap.xml' in robots
# Cloudflare adds separate AI-crawler groups; evaluate search bots, not every group.
groups=[];agents=[];rules=[]
for line in robots.splitlines()+['User-agent: __end__']:
    line=line.split('#',1)[0].strip()
    if ':' not in line:continue
    key,value=line.split(':',1);key=key.lower();value=value.strip()
    if key=='user-agent':
        if rules:groups.append((agents,rules));agents=[];rules=[]
        agents.append(value.lower())
    elif key in ('allow','disallow') and value:rules.append((key,value))
def can_crawl(bot,path):
    specific=[r for a,r in groups if bot.lower() in a]
    selected=specific or [r for a,r in groups if '*' in a]
    matches=[(len(prefix),rule=='allow') for rules in selected for rule,prefix in rules if path.startswith(prefix)]
    return max(matches)[1] if matches else True
for bot in ['Googlebot','Googlebot-Image','Bingbot','Baiduspider']:
    for path in ['/','/lobby','/gallery','/help','/zh','/zh/gallery','/puzzle/'+ids[0],'/zh/puzzle/'+ids[0],'/_next/static/example.js','/puzzles/example.webp']:assert can_crawl(bot,path),(bot,path)
    assert not can_crawl(bot,'/api/user-images'),bot
print(json.dumps({'base':base,'publicPages':len(urls),'englishPages':len(paths),'chinesePages':len(paths),'uniqueTitles':len(titles),
 'languageDeclaredPerPage':True,'hreflangSymmetric':True,'canonicalAndOpenGraph':True,'privateRoutesNoindex':True,
 'unknownAndArchived404':True,'galleryLinks':len(ids)*2,'robotsAndSitemap':True}))
