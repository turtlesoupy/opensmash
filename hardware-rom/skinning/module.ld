SECTIONS {
 . = 0;
 .text : { *(.text.entry) *(.text .text.*) }
 .rodata : { *(.rodata .rodata.*) }
 . = ALIGN(16);
 _gp = . + 0x7ff0;
 .got : { *(.got) }
 .data : { *(.data .data.*) }
 .bss : { *(.bss .bss.* COMMON) }
 .dynamic : { *(.dynamic) }
 .dynsym : { *(.dynsym) }
 .dynstr : { *(.dynstr) }
 .hash : { *(.hash) }
 .rel.dyn : { *(.rel.dyn) }
 /DISCARD/ : { *(.comment .note* .MIPS.abiflags .reginfo .pdr .mdebug* .gnu.attributes) }
}
