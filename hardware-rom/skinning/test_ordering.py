"""Triangle identity, cache limits, and non-regression of the chosen ordering."""
from pathlib import Path
import os
import sys
import unittest
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from skinning.ordering import windows,cost,select,Optimizer
from skinning.export import batches


def triangle(ids,tag):return (ids,tag,bytes([tag%256]))


class OrderingTests(unittest.TestCase):
    def test_empty(self):
        chosen,stats=select([],[],None)
        self.assertEqual(chosen,[])
        self.assertEqual(stats['after']['vertex_loads'],0)

    def test_window_boundaries_and_degenerate_triangles(self):
        records=[triangle((i,i+1,i+2),i) for i in range(0,90,3)]
        records.insert(0,triangle((0,0,0),99))
        groups=list(windows(records))
        self.assertTrue(all(len(ids)<=30 for ids,_ in groups))
        self.assertEqual([t for _,chosen in groups for t,_ in chosen],records)
        self.assertEqual(cost(groups)[0],90)

    def test_worse_candidate_is_not_selected(self):
        records=[triangle((0,1,2),i) for i in range(8)]
        baseline=list(batches(records))
        class Bad:
            def candidates(self,records):
                return [('bad',[([0,1,2],[(t,None)]) for t in records])]
        chosen,stats=select(records,baseline,Bad())
        self.assertEqual(stats['method'],'existing')
        self.assertEqual(cost(chosen),cost(baseline))

    @unittest.skipUnless(os.environ.get('SKIN_ROM'),'Built host optimizer required')
    def test_real_optimizer_preserves_payloads_and_never_regresses(self):
        lib=Path(os.environ['SKIN_ROM']).parent/'mips-runtime/mesh_order.dylib'
        optimizer=Optimizer(lib.resolve())
        records=[]
        for i in range(180):
            x=(i*37)%97
            records.append(triangle((x,(x+1)%100,(x+3)%100),i))
        records += [triangle(records[0][0],201),triangle(tuple(reversed(records[0][0])),202)]
        expected=Counter((tuple(t[0]),t[1],t[2]) for t in records)
        for _,groups in optimizer.candidates(records):
            self.assertTrue(all(len(ids)<=30 for ids,_ in groups))
            self.assertEqual(Counter((tuple(t[0]),t[1],t[2]) for _,chosen in groups for t,_ in chosen),expected)
        baseline=list(batches(records));chosen,_=select(records,baseline,optimizer)
        self.assertLessEqual(cost(chosen),cost(baseline))
