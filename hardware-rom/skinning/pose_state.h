typedef struct {
    s32 njoints;
    u32 joint_ids[SKIN_JOINT_CAP];
    s32 can_parent[SKIN_JOINT_CAP];
    f32 can_root[3], cbind_o[SKIN_JOINT_CAP][3], cbind_m[SKIN_JOINT_CAP][3][3];
    f32 tbind_inv[SKIN_JOINT_CAP][3][3], tbind0_inv[3][3];
    f32 cint_bind[3], tb_cp_m[3][3];
    s32 have_tb_cp_m, nsh, sh_slot[2];
    f32 leg_ratio, van_leg;
} OSB5State;
