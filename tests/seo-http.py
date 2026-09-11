"""Read-only checks against the built HTTP response; no JavaScript rendering required."""
import argparse,json,re,urllib.request,urllib.error,xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('base');parser.add_argument('--local',action='store_true');args=parser.parse_args()
base=args.base.rstrip('/');origin='https://jigsawnook.online'
class Page(HTMLParser):
    def __init__(self):
        super().__init__();self.metas={};self.canonicals=[];self.titles=[];self.links=[];self.h1=[];self.jsonld=[];self.kind=None;self.buffer='';self.lang=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='html':self.lang=a.get('lang')
        if tag=='meta':self.metas[a.get('name',a.get('property',''))]=a.get('content','')
        if tag=='link' and a.get('rel')=='canonical':self.canonicals.append(a.get('href'))
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
status,headers,xml=get('/sitemap.xml');assert status==200
assert 'xml' in headers.get('Content-Type','')
urls=[e.text for e in ET.fromstring(xml).findall('{*}url/{*}loc')]
catalog=json.loads(Path('content/puzzle-catalog.json').read_text(encoding='utf-8'))
ids=[p['id'] for p in catalog if p['status']=='published' and p['origin']=='project-ai-generated']
expected={origin+p for p in ['/','/lobby','/gallery','/help']+['/puzzle/'+i for i in ids]}
assert set(urls)==expected and len(urls)==len(expected)
titles=set();gallery_links=[]
for url in urls:
    path=url.removeprefix(origin);status,headers,html=get(path);assert status==200,(path,status)
    page=Page();page.feed(html)
    assert page.lang=='en',(path,page.lang)
    assert len(page.canonicals)==1 and page.canonicals[0].rstrip('/')==url.rstrip('/'),(path,page.canonicals)
    assert len(page.titles)==1 and page.titles[0] not in titles,(path,page.titles)
    titles.add(page.titles[0]);assert not re.search('[\u3400-\u9fff]',page.titles[0])
    assert len(page.h1)==1 and page.h1[0].strip(),(path,page.h1)
    assert page.metas.get('description') and 'noindex' not in page.metas.get('robots',''),(path,page.metas.get('robots'))
    assert ('noindex' in headers.get('X-Robots-Tag',''))==args.local,(path,headers.get('X-Robots-Tag'))
    assert page.metas.get('og:url','').rstrip('/')==url.rstrip('/') and page.metas.get('og:image','').startswith(origin+'/puzzles/'),path
    if path=='/':assert any(d.get('@type')=='WebSite' for d in page.jsonld)
    if path=='/gallery':gallery_links=page.links
    if path.startswith('/puzzle/'):
        assert page.jsonld and '/gallery?image='+path.split('/')[-1] in page.links,path
for image_id in ids:assert '/puzzle/'+image_id in gallery_links,image_id
for path in ['/account','/personal','/personal/images','/feedback','/membership/manage','/room/00000000000000000000000000000000','/gallery?mode=solo','/gallery?image='+ids[0],'/api/health']:
    status,headers,html=get(path);assert 'noindex' in headers.get('X-Robots-Tag',''),path
for path in ['/puzzle/not-real','/puzzle/skate']:
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
for bot in ['Googlebot','Googlebot-Image','Bingbot']:
    for path in ['/','/lobby','/gallery','/help','/puzzle/'+ids[0],'/_next/static/example.js','/puzzles/example.webp']:assert can_crawl(bot,path),(bot,path)
    assert not can_crawl(bot,'/api/user-images'),bot
print(json.dumps({'base':base,'publicPages':len(urls),'englishSSR':True,'uniqueTitles':len(titles),'canonicalAndOpenGraph':True,'privateRoutesNoindex':True,'unknownAndArchived404':True,'galleryLinks':len(ids),'robotsAndSitemap':True}))
