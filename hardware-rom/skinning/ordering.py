"""Use Battleship's meshoptimizer, scored against the ROM's actual cache windows."""
from collections import defaultdict, deque
import ctypes

CAPACITY = 30


def windows(triangles):
    entries=[];seen=set();chosen=[]
    for triangle in triangles:
        ids=list(map(int,triangle[0]))
        if len(seen | set(ids))>CAPACITY:
            yield entries,chosen
            entries=[];seen=set();chosen=[]
        for vertex in ids:
            if vertex not in seen:entries.append(vertex);seen.add(vertex)
        chosen.append((triangle,None))
    if chosen:yield entries,chosen


def cost(groups):
    # Each disjoint contiguous source run requires its own gSPVertex command.
    loads=sum(len(entries) for entries,_ in groups)
    commands=0
    for entries,_ in groups:
        ordered=sorted(entries)
        commands+=sum(i==0 or v!=ordered[i-1]+1 for i,v in enumerate(ordered))
    return loads,commands,len(groups)


class Optimizer:
    def __init__(self,path):
        self.library=ctypes.CDLL(str(path))
        self.run=self.library.skin_order
        self.run.argtypes=[ctypes.POINTER(ctypes.c_uint),ctypes.POINTER(ctypes.c_uint),ctypes.c_size_t,ctypes.c_size_t,ctypes.c_uint,ctypes.c_int]
        self.run.restype=None

    def candidates(self,triangles):
        if not triangles:return []
        ids=[int(v) for t in triangles for v in t[0]]
        array=ctypes.c_uint*len(ids);source=array(*ids)
        result=[]
        for adaptive in (0,1):
            output=array();self.run(output,source,len(ids),max(ids)+1,CAPACITY,adaptive)
            # Preserve the exact oriented triangle and its material/UV payload,
            # including distinct payloads on duplicate index triples.
            records=defaultdict(deque)
            for triangle in triangles:records[tuple(map(int,triangle[0]))].append(triangle)
            ordered=[]
            for i in range(0,len(ids),3):
                key=tuple(output[i:i+3])
                if not records[key]:raise ValueError('Mesh optimizer changed triangle identity or winding')
                ordered.append(records[key].popleft())
            if any(records.values()):raise ValueError('Mesh optimizer dropped triangles')
            result.append(('adaptive' if adaptive else 'fifo',list(windows(ordered))))
        return result


def select(triangles,baseline,optimizer):
    candidates=[('existing',baseline),('source',list(windows(triangles)))]
    if optimizer:candidates.extend(optimizer.candidates(triangles))
    name,chosen=min(candidates,key=lambda item:cost(item[1]))
    return chosen,dict(method=name,before=dict(zip(('vertex_loads','vertex_commands','windows'),cost(baseline))),after=dict(zip(('vertex_loads','vertex_commands','windows'),cost(chosen))))
