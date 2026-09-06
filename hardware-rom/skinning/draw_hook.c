/* Experimental ROM-only replacement for ftDisplayMainDrawAll. */
#include <ft/fighter.h>

void skin_draw_hook(GObj *gobj)
{
    FTStruct *fp = ftGetStruct(gobj);
    DObj *anchor = fp->joints[4];
    u32 *marker = anchor ? (u32 *)anchor->dl : 0;
    if (marker && marker[0] == 0xdf000000 && marker[2] == 0x534b4e31)
    {
        /* Uncached bootstrap invalidates the loaded module's instruction
         * cache before entering its position-independent cached code. */
        ((void (*)(GObj *,u32 *))(marker[3] | 0x20000000))(gobj,marker);
    }
    else
    {
        u32 *skeleton = (u32 *)fp->attr->skeleton;
        if (fp->colanim.skeleton_id && skeleton && skeleton[fp->colanim.skeleton_id]
            && fp->joints[skeleton[0]] && fp->joints[skeleton[0]]->dl)
            ftDisplayMainDrawSkeleton(DObjGetStruct(gobj));
        else
            ftDisplayMainDrawDefault(DObjGetStruct(gobj));
    }
    if (fp->afterimage.drawstatus >= 2)
        ftDisplayMainDrawAfterImage(fp);
}
