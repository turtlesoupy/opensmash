/* A bounded entry point to upstream HSD animation. This is not a game loop. */
#include <sysdolphin/baselib/aobj.h>
#include <melee/ft/fighter.h>
#include <melee/ft/ftcommon.h>

#define JOINTS 256
#define TRACKS 2048
#define INPUT 65536
#define STORAGE (2 * 1024 * 1024)
static HSD_AObj anim[JOINTS];
static HSD_FObj tracks[TRACKS];
static float bind[JOINTS][9], pose[JOINTS][9];
static unsigned char input[INPUT], storage[STORAGE];
static unsigned joint_count, track_count, storage_used;
static Fighter physics;
static int error;

void __assert(char* file, u32 line, char* message) { __builtin_trap(); }
static void clear(void* ptr, unsigned size) {
    unsigned char* p = ptr;
    for (unsigned i = 0; i < size; i++) p[i] = 0;
}
float fabsf(float f) { return __builtin_fabsf(f); }
static int finite(float f) { return __builtin_isfinite(f); }
static int width(unsigned frac) {
    if (frac == 0) return 4;
    if ((frac & 31) == 31) return 0; /* original signed denominator overflows */
    switch (frac >> 5) { case 1: case 2: return 2; case 3: case 4: return 1; }
    return 0;
}
static int scalar(unsigned* pos, unsigned n, unsigned frac) {
    unsigned w = width(frac), p = *pos;
    if (!w || p + w > n) return 0;
    if (!frac) {
        unsigned bits = (unsigned)input[p] | (unsigned)input[p+1] << 8 |
            (unsigned)input[p+2] << 16 | (unsigned)input[p+3] << 24;
        if ((bits & 0x7f800000) == 0x7f800000) return 0;
    }
    *pos += w; return 1;
}
/* Validate every byte the original decoder can consume before entering it. */
static int validate(unsigned n, unsigned value, unsigned slope) {
    if (!n || n > INPUT || !width(value) || !width(slope)) return 0;
    unsigned p = 0, records = 0;
    while (p < n) {
        unsigned b = input[p++], op = b & 15, count = ((b >> 4) & 7) + 1, shift = 3;
        if (op < 1 || op > 6) return 0;
        while (b & 128) {
            if (p == n || shift > 10) return 0;
            b = input[p++]; count += (b & 127) << shift; shift += 7;
        }
        if (count > 65535) return 0;
        for (unsigned i = 0; i < count; i++) {
            records++;
            if (op != 5 && !scalar(&p, n, value)) return 0;
            if ((op == 4 || op == 5) && !scalar(&p, n, slope)) return 0;
            if (op == 5) continue;
            if (p == n) return i + 1 == count && records >= 2;
            unsigned wait = 0; shift = 0;
            do {
                if (p == n || shift > 14) return 0;
                b = input[p++]; wait |= (b & 127) << shift; shift += 7;
            } while (b & 128);
            if (wait > 65535) return 0;
        }
    }
    return records >= 2;
}
static void update(void* obj, enum_t channel, HSD_ObjData* data) {
    if (channel < 1 || channel > 10 || channel == 4 || !finite(data->fv)) { error = 1; return; }
    float value = data->fv;
    /* JObjUpdateFunc's scale-channel minimum. Other JObj semantics are not
       claimed here: paths, constraints, visibility, and IK remain separate. */
    if (channel >= 8 && value < .001f && value > -.001f) value = .001f;
    ((float*)obj)[channel <= 3 ? channel-1 : channel-2] = value;
}
unsigned char* port_input(void) { return input; }
float* port_bind(void) { return &bind[0][0]; }
float* port_pose(void) { return &pose[0][0]; }
int port_error(void) { return error; }
int port_begin(unsigned joints, float end, int loop) {
    if (!joints || joints > JOINTS || !finite(end) || end <= 0 || end > 10000) return -1;
    clear(anim, sizeof(anim)); clear(tracks, sizeof(tracks)); clear(bind, sizeof(bind));
    joint_count = joints; track_count = storage_used = error = 0;
    for (unsigned i = 0; i < joints; i++) {
        anim[i].end_frame = end; anim[i].framerate = 1;
        anim[i].flags = loop ? AOBJ_LOOP : 0;
        bind[i][6] = bind[i][7] = bind[i][8] = 1;
    }
    return 0;
}
int port_add_track(unsigned joint, unsigned channel, unsigned value, unsigned slope, unsigned n, int start) {
    if (joint >= joint_count || channel < 1 || channel > 10 || channel == 4 || track_count == TRACKS ||
        start < -32768 || start > 32767 || value > 255 || slope > 255 ||
        n > STORAGE - storage_used || !validate(n, value, slope)) return -1;
    /* Reject duplicate channels rather than let reversed insertion change order. */
    for (HSD_FObj* f = anim[joint].fobj; f; f = f->next) if (f->obj_type == channel) return -2;
    HSD_FObj* f = &tracks[track_count++];
    f->next = anim[joint].fobj; anim[joint].fobj = f;
    f->ad_head = &storage[storage_used]; f->length = n;
    for (unsigned i = 0; i < n; i++) storage[storage_used++] = input[i];
    f->obj_type = channel; f->frac_value = value; f->frac_slope = slope; f->startframe = start;
    return 0;
}
int port_seek(float frame) {
    if (!joint_count || !finite(frame) || frame < 0 || frame > 10000) return -1;
    error = 0;
    HSD_AObjInitEndCallBack();
    for (unsigned j = 0; j < joint_count; j++) {
        for (unsigned c = 0; c < 9; c++) {
            if (!finite(bind[j][c])) return -1;
            pose[j][c] = bind[j][c];
        }
        HSD_AObjReqAnim(&anim[j], frame);
        HSD_AObjInterpretAnim(&anim[j], pose[j], update);
    }
    return error ? -2 : 0;
}
int port_step(void) {
    if (!joint_count) return -1;
    HSD_AObjInitEndCallBack();
    for (unsigned j = 0; j < joint_count; j++) HSD_AObjInterpretAnim(&anim[j], pose[j], update);
    return error ? -2 : 0;
}
float port_frame(void) { return anim[0].curr_frame; }
float port_fall(float velocity, float gravity, float terminal) {
    physics.self_vel.y = velocity;
    ftCommon_Fall(&physics, gravity, terminal);
    return physics.self_vel.y;
}
float port_ground_friction(float velocity, float friction) {
    physics.gr_vel = velocity;
    ftCommon_ApplyFrictionGround(&physics, friction);
    return physics.xE4_ground_accel_1;
}

/* Use HSD's actual scale-compensated matrix builder, not a second animation
   implementation in JavaScript. The host provides and receives plain floats. */
#include <sysdolphin/baselib/mtx.h>
static float srt_input[12];
static Mtx srt_output;
float* port_srt_input(void) { return srt_input; }
float* port_srt(int compensate) {
    HSD_MtxSRT(srt_output, (Vec3*)&srt_input[6], (Vec3*)&srt_input[0],
               (Vec3*)&srt_input[3], compensate ? (Vec3*)&srt_input[9] : NULL);
    return &srt_output[0][0];
}
