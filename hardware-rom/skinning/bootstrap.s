.set noreorder
.text
.globl skin_bootstrap
.ent skin_bootstrap
skin_bootstrap:
 addiu $sp,$sp,-32
 sw $ra,28($sp)
 sw $a0,20($sp)
 sw $a1,24($sp)
 lui $t0,0x8013
 lw $t0,0x0d98($t0)
 lw $t1,84($a1)
 beq $t0,$t1,ready
 nop
 sw $t0,16($sp)
 jal 0x80039160
 nop
 lw $a1,24($sp)
 lw $t0,16($sp)
 lw $a0,16($a1)
 addu $a0,$a0,$t0
 lw $a1,20($a1)
 jal 0x800344b0
 nop
 lw $a1,24($sp)
 lw $t0,16($sp)
 sw $t0,84($a1)
ready:
 lw $a0,20($sp)
 lw $t9,16($a1)
 addu $t9,$t9,$t0
 lw $ra,28($sp)
 jr $t9
 addiu $sp,$sp,32
.end skin_bootstrap
