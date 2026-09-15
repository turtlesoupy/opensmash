"""Weighted bind-pose conformation with explicit, reviewed target mapping."""
import numpy as np


def conform(mesh, skeleton, profile):
    if profile.get("ball_fit"):
        from .ball_fit import conform_ball
        return conform_ball(mesh,skeleton,profile)
    if profile.get('normal_smoothing_degrees'):
        from .surfaces import prepared_normals
        mesh = prepared_normals(mesh, profile['normal_smoothing_degrees'])
    mapping = profile['joint_map']
    missing = [name for i, name in enumerate(mesh['names'])
               if np.any(mesh['weights'][mesh['joints'] == i] > 0) and name not in mapping]
    if missing:
        raise ValueError('Unmapped weighted source joints: ' + ', '.join(missing))
    scale = profile.get('bone_scale', 1.0)
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError('bone_scale must be positive')
    count = len(mesh['positions'])
    out_pos = np.zeros((count,3))
    out_nrm = np.zeros((count,3))
    influences = [dict() for _ in range(count)]
    source_p = np.c_[mesh['positions'], np.ones(count)]
    for source_index, name in enumerate(mesh['names']):
        mask = mesh['joints'] == source_index
        weight = np.where(mask, mesh['weights'], 0).sum(axis=1)
        active = weight > 0
        if not np.any(active):
            continue
        target_index = mapping[name]
        if type(target_index) is not int or not 0 <= target_index < len(skeleton):
            raise ValueError(f'Invalid target joint for {name}')
        target = skeleton[target_index]
        if target['inverse_bind'] is None:
            raise ValueError(f'{name}: target joint {target_index} has no archived inverse bind')
        target_bind = np.linalg.inv(np.array(target['inverse_bind']))
        source_bind = mesh['bind'][source_index]
        # A per-bone correction can reconcile source/target bone axes without
        # importing SSB64's dominant-joint partitioning or manual seam patches.
        correction = np.array(profile.get('bone_corrections', {}).get(name, np.eye(4)))
        if correction.shape != (4,4) or not np.isfinite(correction).all() or not np.allclose(correction[3],[0,0,0,1]):
            raise ValueError(f'{name}: invalid bone correction')
        matrix = target_bind @ correction @ np.diag([scale,scale,scale,1]) @ np.linalg.inv(source_bind)
        if abs(np.linalg.det(matrix[:3,:3])) < 1e-10:
            raise ValueError('Singular bind conversion')
        p = (matrix @ source_p[active].T).T[:,:3]
        n = (np.linalg.inv(matrix[:3,:3]).T @ mesh['normals'][active].T).T
        out_pos[active] += p * weight[active,None]
        out_nrm[active] += n * weight[active,None]
        for vertex in np.flatnonzero(active):
            influences[vertex][target_index] = influences[vertex].get(target_index,0) + float(weight[vertex])
    norm = np.linalg.norm(out_nrm, axis=1)
    if np.any(norm < 1e-10) or not np.isfinite(out_pos).all():
        raise ValueError('Degenerate retargeted normals/positions')
    out_nrm /= norm[:,None]
    envelopes = []
    for inf in influences:
        total = sum(inf.values())
        # Float32 is HSD's storage precision; deduplicate exact stored envelopes.
        env = tuple((j, float(np.float32(w/total))) for j,w in sorted(inf.items()))
        envelopes.append(env)
    return dict(mesh, positions=out_pos, normals=out_nrm, envelopes=envelopes)


def skin(positions, envelopes, posed_world, inverse_bind):
    """CPU oracle for exported HSD envelope blending, in model space."""
    out = np.zeros_like(positions, dtype=float)
    points = np.c_[positions,np.ones(len(positions))]
    for i, env in enumerate(envelopes):
        for joint, weight in env:
            out[i] += weight * (posed_world[joint] @ inverse_bind[joint] @ points[i])[:3]
    return out
