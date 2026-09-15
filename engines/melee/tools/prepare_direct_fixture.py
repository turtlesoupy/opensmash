"""Prepare the four-character validation fixture through the normal local launcher API."""
import argparse,json,urllib.request,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:5189');p.add_argument('--output',type=Path,default=ROOT/'build/direct-c/four-fixture');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 entries=[dict(character=c,target=t,fighter=f,color=k,filename=n) for c,t,f,k,n in [('alanturing','mario',8,0,'PlMrNr.dat'),('abrahamlincoln','fox',2,0,'PlFxNr.dat'),('stevejobs','mario',8,1,'PlMrYe.dat'),('50cent','mario',8,2,'PlMrBk.dat')]]
 def request(path,body=None,method='GET'):
  data=None if body is None else json.dumps(body).encode();r=urllib.request.Request(a.url.rstrip('/')+path,data=data,method=method,headers={'Content-Type':'application/json'});return urllib.request.urlopen(r,timeout=240).read()
 names=[]
 def save(name,data):
  if name.startswith('/') or '..' in Path(name).parts:raise ValueError('Invalid asset filename')
  out=a.output/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data);names.append(name)
 for entry in entries:
  info=json.loads(request('/api/prepare/'+entry['character']+'?'+urllib.parse.urlencode(dict(target=entry['target'],color=entry['color'],skin='host',compact=1)),method='POST'));save(entry['filename'],request(info['url']))
 css=json.loads(request('/api/character-select',dict(costumes=entries),'POST'))
 for asset in css['assets']:save(asset['filename'],request(asset['url']))
 (a.output/'manifest.json').write_text(json.dumps(names)+'\n');print(a.output)
if __name__=='__main__':main()
