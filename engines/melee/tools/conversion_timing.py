"""Opt-in wall-clock instrumentation used only in disposable profiling copies."""
import ast

TARGETS = {
    'tools/build_character.py': {'main'},
    'tools/build_browser_skin_costume.py': {'build'},
    'opensmash_melee/__main__.py': {'import_character', 'digest', 'atomic_write'},
    'opensmash_melee/glb.py': {'__init__', 'mesh'},
    'opensmash_melee/archive.py': {'read', 'serialize'},
    'opensmash_melee/roster_fit.py': {'profile_for'},
    'opensmash_melee/multi_fighter.py': {'fit', 'load_target'},
    'opensmash_melee/proportions.py': {'source_head_fit'},
    'opensmash_melee/retarget.py': {'conform'},
    'opensmash_melee/surfaces.py': {'smooth_normals', 'refine_profile'},
    'opensmash_melee/presentation.py': {'panel', 'import_stencil', 'stock_image'},
    'opensmash_melee/gx.py': {'replace_costume', 'polygons', 'rgba8', 'batches'},
    'opensmash_melee/browser_skin.py': {'build_costume'},
    'tools/inspect_costume_bounds.py': {'inspect'},
    'tools/validate_shape.py': {'shape_metrics'},
}

RUNTIME = '''import atexit,functools,json,os,time
from pathlib import Path
from contextlib import contextmanager
started=time.perf_counter()
events=[]
stack=[]
def timed(label):
 def decorate(fn):
  @functools.wraps(fn)
  def wrapped(*a,**kw):
   detail={}
   if label.endswith(':smooth_normals'):
    import hashlib
    detail['input_sha256']=hashlib.sha256(b''.join(a[0][k].tobytes() for k in ('positions','normals','triangles'))).hexdigest()
    detail['angle']=a[1] if len(a)>1 else kw.get('angle_degrees',55)
   if label.endswith(':conform'):
    import hashlib
    detail['profile']=json.loads(json.dumps(a[2],default=lambda x:x.tolist()))
   result=None
   start=time.perf_counter();frame=[0.0];stack.append(frame)
   try:
    result=fn(*a,**kw)
    return result
   finally:
    elapsed=time.perf_counter()-start;stack.pop()
    if stack:stack[-1][0]+=elapsed
    if label.endswith(':conform') and result is not None:
     detail['output_sha256']={k:hashlib.sha256(result[k].tobytes()).hexdigest() for k in ('positions','normals')}
    events.append(dict(stage=label,ms=elapsed*1000,self_ms=(elapsed-frame[0])*1000,start_ms=(start-started)*1000,**detail))
  return wrapped
 return decorate
@contextmanager
def span(label):
 start=time.perf_counter();frame=[0.0];stack.append(frame)
 try:yield
 finally:
  elapsed=time.perf_counter()-start;stack.pop()
  if stack:stack[-1][0]+=elapsed
  events.append(dict(stage=label,ms=elapsed*1000,self_ms=(elapsed-frame[0])*1000,start_ms=(start-started)*1000))
def save():
 destination=os.environ.get('MELEE_TIMING_DIR')
 if destination:
  Path(destination, 'stages-'+str(os.getpid())+'.json').write_text(json.dumps(events,indent=2))
atexit.register(save)
'''

def instrument(root, hooks):
    (hooks/'melee_timing.py').write_text(RUNTIME)
    for relative,names in TARGETS.items():
        path=root/relative
        tree=ast.parse(path.read_text())
        class Imports(ast.NodeTransformer):
            def visit_ImportFrom(self,node):
                return ast.With(items=[ast.withitem(context_expr=ast.Call(func=ast.Name(id='_conversion_span',ctx=ast.Load()),args=[ast.Constant(relative+':import '+str(node.module))],keywords=[]))],body=[node])
            def visit_Import(self,node):
                return ast.With(items=[ast.withitem(context_expr=ast.Call(func=ast.Name(id='_conversion_span',ctx=ast.Load()),args=[ast.Constant(relative+':import '+','.join(a.name for a in node.names))],keywords=[]))],body=[node])
        for node in list(ast.walk(tree)):
            if isinstance(node,ast.FunctionDef) and node.name in names:
                node.body=[Imports().visit(statement) for statement in node.body]
                node.decorator_list.append(ast.Call(func=ast.Name(id='_conversion_timed',ctx=ast.Load()),args=[ast.Constant(relative+':'+node.name)],keywords=[]))
        index=1 if tree.body and isinstance(tree.body[0],ast.Expr) and isinstance(tree.body[0].value,ast.Constant) and isinstance(tree.body[0].value.value,str) else 0
        while index<len(tree.body) and isinstance(tree.body[index],ast.ImportFrom) and tree.body[index].module=='__future__':index+=1
        tree.body.insert(index,ast.ImportFrom(module='melee_timing',names=[ast.alias(name='timed',asname='_conversion_timed'),ast.alias(name='span',asname='_conversion_span')],level=0))
        path.write_text(ast.unparse(ast.fix_missing_locations(tree))+'\n')
