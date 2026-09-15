"""Exercise source imports with the running Python or packaged backend.

Pass current source manifest URLs. Assets are fetched once and still undergo the
normal manifest/hash/image/mesh checks on every import. Run in an isolated
workspace with validated game files; the report contains no bearer URLs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee import character_import as importer
from opensmash_melee.targets import PLAYABLE


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('urls',nargs='+')
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--targets',nargs='+',choices=PLAYABLE,default=list(PLAYABLE))
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    fetched={};original_import=importer.import_source
    def fetch(url,limit):
        if url not in fetched:fetched[url]=importer.download(url,limit)
        raw=fetched[url]
        if len(raw)>limit:raise ValueError('Cached asset exceeds size limit')
        return raw
    importer.import_source=lambda url,destination,origins:original_import(url,destination,origins,fetch=fetch)
    manager=importer.ImportManager({},threading.Lock(),workspace=root)
    rows=[];retry={}
    try:
        for index,url in enumerate(args.urls):
            for target in args.targets:
                job={'id':f'validation-{index}-{target}'}
                manager.work(job,url,target)
                row={'sourceIndex':index,'target':target,'state':job['state']}
                if job['state']=='complete':
                    fighter=job['fighter'];ident='web-v1-'+hashlib.sha256(fighter['slug'].encode()).hexdigest()[:16]
                    output=root/'build/characters'/ident
                    costumes=list((output/'browser').glob('Pl*Nr.dat'))
                    assert len(costumes)==1 and costumes[0].stat().st_size>0
                    row.update(name=fighter['name'],browserCostumeBytes=costumes[0].stat().st_size,shape=json.loads((output/'shape.json').read_text()))
                else:row['error']=job['message']
                rows.append(row)
                print(f"{index+1}/{len(args.urls)} {target}: {job['state']}",flush=True)
        # Remove only a validation roster entry, preserving its existing build.
        # A genuine failed subprocess must preserve source and allow a retry.
        first=next((r for r in manager.rows if r['target']==args.targets[0]),None)
        if first:
            manager.rows.remove(first);manager.catalog.pop(first['slug'])
            real_stage=importer.run_stage
            def fail_stage(command,*rest):return real_stage([*command,'--invalid-validation-option'],*rest)
            importer.run_stage=fail_stage
            failed={'id':'validation-failed-retry'}
            try:manager.work(failed,args.urls[0],args.targets[0])
            finally:importer.run_stage=real_stage
            assert failed['state']=='failed',failed
            assert (manager.root/'failed-source-validation-failed-retry/rigged.glb').is_file()
            again={'id':'validation-successful-retry'}
            manager.work(again,args.urls[0],args.targets[0])
            assert again['state']=='complete',again
            retry={'failedStage':failed.get('stage'),'retryState':again['state'],'sourcePreserved':True}
    finally:
        manager.pool.shutdown()
        report={'frozenBackend':bool(getattr(sys,'frozen',False)),'imports':rows,'retry':retry,'downloadedAssets':len(fetched)}
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    if len(rows)!=len(args.urls)*len(args.targets) or any(r['state']!='complete' for r in rows):raise SystemExit('Import validation failed; see report')

if __name__=='__main__':main()
