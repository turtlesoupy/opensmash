"""Exact float bytes, not approximate equality, protect exported costume parity."""
import unittest
import numpy as np
from smoothing_reference import smooth_normals as reference
from opensmash_melee.surfaces import smooth_normals

class SmoothingEquivalence(unittest.TestCase):
    def test_generated_topologies(self):
        for seed in range(60):
            rng=np.random.default_rng(seed)
            positions=rng.integers(-3,4,size=(100,3)).astype(float)
            positions[50:70]=positions[:20] # UV duplicates and coincident shells
            normals=rng.normal(size=(100,3))
            if seed % 2:normals=normals.astype(np.float32)
            normals[50:60]=normals[:10]
            before=normals.tobytes()
            triangles=rng.integers(0,90,size=(150,3)) # isolated and non-manifold vertices
            mesh=dict(positions=positions,normals=normals,triangles=triangles)
            for angle in (1,30,55,89):
                with self.subTest(seed=seed,angle=angle):
                    expected=reference(mesh,angle)['normals']
                    actual=smooth_normals(mesh,angle)['normals']
                    self.assertEqual(expected.tobytes(),actual.tobytes())
                    self.assertEqual(before,mesh['normals'].tobytes())

    def test_build_scope_reuses_and_invalidates(self):
        from unittest.mock import patch
        from opensmash_melee import surfaces
        rng=np.random.default_rng(42)
        mesh=dict(positions=rng.normal(size=(8,3)),normals=rng.normal(size=(8,3)),triangles=np.array([[0,1,2],[2,1,3]]))
        with patch.object(surfaces,'smooth_normals',wraps=surfaces.smooth_normals) as run:
            with surfaces.smoothing_scope():
                first=surfaces.prepared_normals(mesh,55)
                second=surfaces.prepared_normals(mesh,55)
                self.assertEqual(first['normals'].tobytes(),second['normals'].tobytes())
                self.assertEqual(run.call_count,1)
                first['normals'][:]=0
                self.assertEqual(second['normals'].tobytes(),surfaces.prepared_normals(mesh,55)['normals'].tobytes())
                mesh['normals'][0,0]+=1
                surfaces.prepared_normals(mesh,55)
                surfaces.prepared_normals(mesh,30)
                self.assertEqual(run.call_count,3)
            with surfaces.smoothing_scope():
                surfaces.prepared_normals(mesh,55)
                self.assertEqual(run.call_count,4)
