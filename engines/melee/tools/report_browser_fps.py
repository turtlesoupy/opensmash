"""Summarize independent combat windows, grouped by runtime and character."""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def report(trace, output=None):
    sessions={}
    for line in Path(trace).read_text().splitlines():
        entry=json.loads(line);key=entry.get('sessionId')
        if not key:continue
        if entry['type']=='session':sessions[key]={'session':entry,'windows':[],'errors':[]}
        if entry['type']=='combat-performance' and key in sessions:
            sessions[key]['windows'].append(entry)
        if entry['type']=='error' and key in sessions:
            sessions[key]['errors'].append(entry.get('message','Runtime error'))
    result=[]
    for record in sessions.values():
        windows=record['windows'];session=record['session']
        if not windows:continue
        passes=session.get('mode')=='cpu-benchmark' and not record['errors'] and len(windows)>=3 and all(w.get('profile',session['profile'])=='0' and w['passes'] and w['audioUnderrunSamples']==0 and w.get('audioRenderedSamples',0)>=w['durationMs']*48*.95 for w in windows[-3:])
        result.append({'character':session['character'],'build':session['build']['id'],
            'sessionId':session['sessionId'],'skin':session.get('skin','gx'),
            'mode':session.get('mode','human'),
            'linkOptimization':session['build']['linkOptimization'],'profile':session['profile'],
            'combatWindows':len(windows),'fps':[round(w['fps'],2) for w in windows],
            'windowProfiles':[w.get('profile',session['profile']) for w in windows],
            'p95ms':[w['p95'] for w in windows],'p99ms':[w['p99'] for w in windows],
            'audioUnderrunSamples':[w['audioUnderrunSamples'] for w in windows],
            'audioRenderedSamples':[w.get('audioRenderedSamples') for w in windows],
            'errors':record['errors'],'passesSustained60':passes})
    text=json.dumps(result,indent=2)+'\n'
    if output:Path(output).write_text(text)
    print(text,end='')
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--trace',default=ROOT/'build/moderngekko-validation/browser-trace.jsonl')
    p.add_argument('--output');a=p.parse_args();report(a.trace,a.output)
