"""Original alternate forms needed when Melee hides a custom fighter's body."""

VERSION = 1

# Inspected GALE01 neutral costume joints. Each owns both normal and low-detail
# versions of the alternate form, controlled by the original visibility tables.
# Resolve by symbol too: older cached/probe profiles omit base_fighter.
FORM_JOINTS = {
    'PlyKoopa5K_Share_joint': (23,),  # withdrawn shell
    'PlyYoshi5K_Share_joint': (3,),   # shield / Egg Roll egg
}


def form_joints(profile):
    return {'bowser':(23,), 'yoshi':(3,)}.get(profile.get('base_fighter'), FORM_JOINTS.get(profile.get('symbol'), ()))


def forms_current(stats, profile):
    return not form_joints(profile) or stats.get('costume_forms_version') == VERSION
