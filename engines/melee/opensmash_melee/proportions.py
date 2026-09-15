"""Preserve authored head shape and head-to-body scale during conformation."""
import copy
import numpy as np
from .retarget import conform

ORIENTATION=np.array([[0,0,-1],[0,1,0],[1,0,0]],float)

def source_head_fit(mesh,skeleton,profile, *, return_fitted=False):
    """Uniform source head scale from ground-to-head-anchor body scale."""
    p=copy.deepcopy(profile);base=conform(mesh,skeleton,p)
    i=mesh['names'].index('Head');origin=mesh['bind'][i][:3,3]
    target=np.linalg.inv(skeleton[p['joint_map']['Head']]['inverse_bind'])
    source_ground=float(mesh['positions'][:,1].min())
    weights=np.where(mesh['joints']==i,mesh['weights'],0).sum(axis=1)
    ground=float(base['positions'][weights<.5,1].min())
    span=origin[1]-source_ground
    if span<=1e-6:raise ValueError('Head anchor must be above source ground')
    scale=(target[1,3]-ground)/span
    if not np.isfinite(scale) or scale<=0:raise ValueError('Invalid source proportion scale')
    affine=np.eye(4);affine[:3,:3]=ORIENTATION*scale
    affine[:3,3]=target[:3,3]-affine[:3,:3]@origin
    p['bone_corrections']['Head']=(np.linalg.inv(target)@affine@mesh['bind'][i]).tolist()
    p['fit_scales']['Head']={'length':float(scale),'width':float(scale)}
    p.update(fit_version=6,head_style='source',head_reference={'source_ground':source_ground,'fitted_body_ground':ground,'source_body_span':float(span)})
    # The highest point can belong to an ear, tail, or blended neck rather
    # than the head. Anchor distance alone then misses the authored ratio.
    # Refine only failing fits, keeping the head uniform and its anchor fixed.
    fitted=None
    core=weights>.99
    if core.sum()>=4:
        source_fraction=np.ptp(mesh['positions'][core,1])/np.ptp(mesh['positions'][:,1])
        fitted=conform(mesh,skeleton,p)
        fitted_y=fitted['positions'][:,1]
        slope=weights*(mesh['positions'][:,1]-origin[1])
        def fraction_error(candidate):
            y=fitted_y+(candidate-scale)*slope
            return np.ptp(y[core])/np.ptp(y)/source_fraction-1
        if source_fraction>0 and abs(fraction_error(scale))>.05:
            # Tall targets and appendages above the head can require more than
            # a 25% adjustment. Solve for the authored ratio over a bounded
            # uniform scale range; the final geometry checks still apply.
            low,high=scale*.5,scale*2
            low_error,high_error=fraction_error(low),fraction_error(high)
            if np.isfinite([low_error,high_error]).all() and low_error*high_error<=0:
                for _ in range(32):
                    mid=(low+high)/2
                    if fraction_error(mid)*low_error>0:
                        low=mid;low_error=fraction_error(mid)
                    else:high=mid
                corrected=(low+high)/2
                affine[:3,:3]=ORIENTATION*corrected
                affine[:3,3]=target[:3,3]-affine[:3,:3]@origin
                p['bone_corrections']['Head']=(np.linalg.inv(target)@affine@mesh['bind'][i]).tolist()
                p['fit_scales']['Head']={'length':float(corrected),'width':float(corrected)}
                p['head_reference']['anchor_scale']=float(scale)
                p['head_reference']['proportion_refinement_version']=2
                fitted=None # The correction changed after the measured fit.
    if return_fitted:
        return p, fitted if fitted is not None else conform(mesh,skeleton,p)
    return p
