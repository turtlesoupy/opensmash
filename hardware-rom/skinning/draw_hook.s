.set noreorder
.set noat
.text
.globl skin_draw_hook
.ent skin_draw_hook
skin_draw_hook:
 addiu $sp,$sp,-24
 sw $ra,20($sp)
 sw $s0,16($sp)
 lw $s0,0x84($a0)
 lw $t0,0x8f8($s0)
 beqz $t0,vanilla
 nop
 lw $a1,0x50($t0)
 beqz $a1,vanilla
 lui $t1,0x534b
 lw $t0,8($a1)
 ori $t1,$t1,0x4e31
 bne $t0,$t1,vanilla
 lui $t0,0x2000
 lw $t9,12($a1)
 or $t9,$t9,$t0
 jalr $t9
 nop
 b after
 nop
vanilla:
 lbu $t0,0xa88($s0)
 srl $t0,$t0,3
 andi $t0,$t0,3
 beqz $t0,normal
 lw $a0,0x74($a0)
 lw $t1,0x9c8($s0)
 lw $t1,0x344($t1)
 beqz $t1,normal
 sll $t0,$t0,2
 addu $t0,$t0,$t1
 lw $t0,0($t0)
 beqz $t0,normal
 lw $t1,0($t1)
 sll $t1,$t1,2
 addu $t1,$s0,$t1
 lw $t1,0x8e8($t1)
 beqz $t1,normal
 nop
 lw $t1,0x50($t1)
 beqz $t1,normal
 nop
 jal ftDisplayMainDrawSkeleton
 nop
 b after
 nop
normal:
 jal ftDisplayMainDrawDefault
 nop
after:
 lb $t0,0xa9d($s0)
 slti $t0,$t0,2
 bnez $t0,done
 nop
 jal ftDisplayMainDrawAfterImage
 move $a0,$s0
done:
 lw $ra,20($sp)
 lw $s0,16($sp)
 jr $ra
 addiu $sp,$sp,24
.end skin_draw_hook
