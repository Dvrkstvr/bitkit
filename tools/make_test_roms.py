#!/usr/bin/env python3
"""BitKit test cards: three tiny ROMs written from scratch for the emulator apps (MIT, like the rest of BitKit).
A checkerboard that scrolls, a block you move with the D-pad, and a beep on A. One for the Game Boy, one for the
Game Boy Color (same program, colour palettes) and one for the NES. They let the apps show something before you
add your own games, and the tests use them.

Usage: python3 tools/make_test_roms.py            -> writes studio/emuroms.js (the cards, built into the studio)
       python3 tools/make_test_roms.py DIR        -> also writes DIR/bitkit-test.gb, .gbc and .nes
"""
import base64, json, pathlib, sys


class Asm:
    """Just enough of an assembler: bytes, labels, 8-bit relative and 16-bit absolute references."""
    def __init__(self, org):
        self.org, self.b, self.labels, self.fix = org, bytearray(), {}, []

    def __call__(self, *bs):
        for x in bs:
            if isinstance(x, str):
                self.fix.append((len(self.b), x)); self.b += b'\0\0' if not x.startswith('~') else b'\0'
            else:
                self.b.append(x & 0xFF)
        return self

    def label(self, n): self.labels[n] = self.org + len(self.b)
    def rel(self, n): self.fix.append((len(self.b), '~' + n)); self.b.append(0)   # jr / branch target
    def w(self, v): self.b += bytes((v & 0xFF, v >> 8))

    def done(self):
        for at, n in self.fix:
            if n.startswith('~'):
                d = self.labels[n[1:]] - (self.org + at + 1)
                assert -128 <= d <= 127, n
                self.b[at] = d & 0xFF
            else:
                v = self.labels[n]; self.b[at] = v & 0xFF; self.b[at + 1] = v >> 8
        return bytes(self.b)


def gb(color):
    a = Asm(0x150)
    LD_A, LDH_W, LDH_R, CP, XOR_A, INC_A, CPL, AND = 0x3E, 0xE0, 0xF0, 0xFE, 0xAF, 0x3C, 0x2F, 0xE6
    def ld_mem_a(addr): a(0xEA); a.w(addr)
    def ld_a_mem(addr): a(0xFA); a.w(addr)
    def jr(cc, n): a({'': 0x18, 'nz': 0x20, 'z': 0x28, 'nc': 0x30, 'c': 0x38}[cc]); a.rel(n)
    def loop_b(n, body):            # ld b,n / body / dec b / jr nz
        a(0x06, n); a.label(body + '_top')
    a(0xF3)                                         # di
    a(0x31); a.w(0xFFFE)                            # ld sp,$fffe
    a.label('wv'); a(LDH_R, 0x44, CP, 144); jr('c', 'wv')     # wait for vblank
    a(XOR_A, LDH_W, 0x40)                           # LCD off
    a(0x21); a.w(0x8010)                            # ld hl,$8010 (tile 1)
    a(0x06, 16, LD_A, 0xFF); a.label('t1'); a(0x22, 0x05); jr('nz', 't1')   # solid block
    a(0x06, 4); a.label('t2'); a(LD_A, 0xF0, 0x22, LD_A, 0x0F, 0x22, 0x05); jr('nz', 't2')   # tile 2: checker
    a(0x06, 4); a.label('t3'); a(LD_A, 0x0F, 0x22, LD_A, 0xF0, 0x22, 0x05); jr('nz', 't3')
    a(0x21); a.w(0x9800); a(0x0E, 4)                # the background map: all tile 2
    a.label('m0'); a(0x06, 0); a.label('m1'); a(LD_A, 2, 0x22, 0x05); jr('nz', 'm1'); a(0x0D); jr('nz', 'm0')
    a(0x21); a.w(0xFE00); a(0x06, 160, XOR_A); a.label('o1'); a(0x22, 0x05); jr('nz', 'o1')   # clear sprites
    a(LD_A, 80); ld_mem_a(0xC000); a(LD_A, 84); ld_mem_a(0xC001)
    a(0xCD, 'spr')                                  # call spr
    a(LD_A, 0xE4, LDH_W, 0x47, LDH_W, 0x48)         # DMG palettes
    a(LD_A, 0x80, LDH_W, 0x68); a(0x21, 'bgpal'); a(0x06, 8); a.label('p1'); a(0x2A, LDH_W, 0x69, 0x05); jr('nz', 'p1')
    a(LD_A, 0x80, LDH_W, 0x6A); a(0x21, 'objpal'); a(0x06, 8); a.label('p2'); a(0x2A, LDH_W, 0x6B, 0x05); jr('nz', 'p2')
    a(LD_A, 0x80, LDH_W, 0x26, LD_A, 0x77, LDH_W, 0x24, LD_A, 0xFF, LDH_W, 0x25)   # sound on
    a(LD_A, 0x93, LDH_W, 0x40)                      # LCD on: bg + sprites, tiles at $8000
    a(XOR_A); ld_mem_a(0xC002)
    a.label('main')
    a.label('w1'); a(LDH_R, 0x44, CP, 144); jr('nz', 'w1')
    a(LDH_R, 0x43, INC_A, LDH_W, 0x43)              # scroll
    a(LD_A, 0x20, LDH_W, 0x00, LDH_R, 0x00, LDH_R, 0x00, CPL, AND, 0x0F, 0x47)   # d-pad -> b
    for bit, addr, op in ((1, 0xC001, INC_A), (2, 0xC001, 0x3D), (4, 0xC000, 0x3D), (8, 0xC000, INC_A)):
        skip = f'd{bit}'
        a(0x78, AND, bit); jr('z', skip); ld_a_mem(addr); a(op); ld_mem_a(addr); a.label(skip)
    a(LD_A, 0x10, LDH_W, 0x00, LDH_R, 0x00, LDH_R, 0x00, CPL, AND, 0x0F, 0x4F)   # buttons -> c
    a(LD_A, 0x30, LDH_W, 0x00)
    a(0x79, AND, 1); jr('z', 'noA'); ld_a_mem(0xC002); a(AND, 1); jr('nz', 'noA')
    a(XOR_A, LDH_W, 0x10, LD_A, 0x80, LDH_W, 0x11, LD_A, 0xF3, LDH_W, 0x12, LD_A, 0x83, LDH_W, 0x13, LD_A, 0x87, LDH_W, 0x14)   # beep
    a.label('noA'); a(0x79); ld_mem_a(0xC002)
    a(0xCD, 'spr')
    a.label('w2'); a(LDH_R, 0x44, CP, 144); jr('z', 'w2')
    a(0xC3, 'main')
    a.label('spr'); ld_a_mem(0xC000); ld_mem_a(0xFE00); ld_a_mem(0xC001); ld_mem_a(0xFE01)
    a(LD_A, 1); ld_mem_a(0xFE02); a(XOR_A); ld_mem_a(0xFE03); a(0xC9)
    def rgb(r, g, b): return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)
    a.label('bgpal')
    for c in ((248, 240, 216), (120, 208, 168), (72, 104, 200), (16, 16, 40)): a.w(rgb(*c))
    a.label('objpal')
    for c in ((0, 0, 0), (248, 200, 80), (232, 96, 64), (232, 64, 72)): a.w(rgb(*c))
    code = a.done()
    rom = bytearray(32768)
    rom[0x100:0x104] = bytes((0x00, 0xC3, 0x50, 0x01))          # nop; jp $150
    rom[0x134:0x134 + 11] = b'BITKIT TEST'
    rom[0x143] = 0xC0 if color else 0x00
    rom[0x147] = rom[0x148] = rom[0x149] = 0
    rom[0x14A] = 1
    x = 0
    for i in range(0x134, 0x14D): x = (x - rom[i] - 1) & 0xFF
    rom[0x14D] = x
    rom[0x150:0x150 + len(code)] = code
    s = sum(rom) - rom[0x14E] - rom[0x14F]
    rom[0x14E], rom[0x14F] = (s >> 8) & 0xFF, s & 0xFF
    return bytes(rom)


def nes():
    a = Asm(0xC000)
    def abs_(op, addr): a(op); a.w(addr)
    LDA, STA, LDX, LDY = 0xA9, 0x8D, 0xA2, 0xA0
    a.label('reset')
    a(0x78, 0xD8, LDX, 0xFF, 0x9A, 0xE8)            # sei cld ldx #$ff txs inx
    abs_(0x8E, 0x2000); abs_(0x8E, 0x2001); abs_(0x8E, 0x4010)
    a(LDA, 0x40); abs_(STA, 0x4017)
    a.label('vb1'); abs_(0x2C, 0x2002); a(0x10); a.rel('vb1')
    a.label('vb2'); abs_(0x2C, 0x2002); a(0x10); a.rel('vb2')
    a(LDA, 0xFF, LDX, 0); a.label('c1'); abs_(0x9D, 0x0200); a(0xE8, 0xD0); a.rel('c1')   # sprites off screen
    for addr, v in ((0x0200, 0x70), (0x0201, 1), (0x0202, 0), (0x0203, 0x78)): a(LDA, v); abs_(STA, addr)
    abs_(0xAD, 0x2002); a(LDA, 0x3F); abs_(STA, 0x2006); a(LDA, 0); abs_(STA, 0x2006)
    a(LDX, 0); a.label('p1'); a(0xBD, 'pal'); abs_(STA, 0x2007); a(0xE8, 0xE0, 32, 0xD0); a.rel('p1')
    a(LDA, 0x20); abs_(STA, 0x2006); a(LDA, 0); abs_(STA, 0x2006)
    a(LDY, 4, LDA, 2, LDX, 0); a.label('n1'); abs_(STA, 0x2007); a(0xE8, 0xD0); a.rel('n1'); a(0x88, 0xD0); a.rel('n1')
    a(LDA, 0x0F); abs_(STA, 0x4015)
    a(LDA, 0); abs_(STA, 0x2005); abs_(STA, 0x2005)
    a(LDA, 0x80); abs_(STA, 0x2000); a(LDA, 0x1E); abs_(STA, 0x2001)
    a.label('loop'); a(0x4C, 'loop')
    a.label('nmi')
    a(LDA, 0); abs_(STA, 0x2003); a(LDA, 2); abs_(STA, 0x4014)
    a(LDA, 1); abs_(STA, 0x4016); a(LDA, 0); abs_(STA, 0x4016)
    a(LDX, 8); a.label('r1'); abs_(0xAD, 0x4016); a(0x4A, 0x26, 0x10, 0xCA, 0xD0); a.rel('r1')
    for bit, op, addr in ((1, 0xEE, 0x0203), (2, 0xCE, 0x0203), (8, 0xCE, 0x0200), (4, 0xEE, 0x0200)):
        a(0xA5, 0x10, 0x29, bit, 0xF0, 3); abs_(op, addr)
    a(0xA5, 0x10, 0x29, 0x80, 0xF0); a.rel('noA'); a(0xA5, 0x11, 0x29, 0x80, 0xD0); a.rel('noA')
    for addr, v in ((0x4000, 0x9F), (0x4001, 0x08), (0x4002, 0xFD), (0x4003, 0xF8)): a(LDA, v); abs_(STA, addr)
    a.label('noA'); a(0xA5, 0x10, 0x85, 0x11)
    a(0xE6, 0x12, 0xA5, 0x12); abs_(STA, 0x2005); a(LDA, 0); abs_(STA, 0x2005)
    a(0x40)                                         # rti
    a.label('irq'); a(0x40)
    a.label('pal')
    a(*([0x0F, 0x21, 0x11, 0x30] * 4)); a(*([0x0F, 0x16, 0x27, 0x30] * 4))
    code = a.done()
    prg = bytearray(16384)
    prg[:len(code)] = code
    for i, n in enumerate(('nmi', 'reset', 'irq')):
        v = a.labels[n]; prg[0x3FFA + i * 2] = v & 0xFF; prg[0x3FFB + i * 2] = v >> 8
    chr_ = bytearray(8192)
    chr_[16:32] = b'\xff' * 16
    chr_[32:48] = b'\xf0' * 4 + b'\x0f' * 4 + b'\x0f' * 4 + b'\xf0' * 4
    return b'NES\x1a' + bytes((1, 1, 0, 0)) + b'\0' * 8 + bytes(prg) + bytes(chr_)


def sparse(rom):
    """The ROM as its size plus the runs of bytes that are not zero (the cards are mostly empty)."""
    runs, i, n = [], 0, len(rom)
    while i < n:
        if rom[i] == 0: i += 1; continue
        j = i
        while j < n and (rom[j] != 0 or any(rom[j:j + 16])): j += 1
        runs.append([i, base64.b64encode(rom[i:j]).decode()]); i = j
    return {'size': n, 'runs': runs}


if __name__ == '__main__':
    roms = {'gb': gb(False), 'gbc': gb(True), 'nes': nes()}
    root = pathlib.Path(__file__).resolve().parent.parent
    cards = {k: sparse(v) for k, v in roms.items()}
    (root / 'studio' / 'emuroms.js').write_text(
        '/* BitKit test cards: tiny ROMs written from scratch for the emulator apps (tools/make_test_roms.py makes this file).\n'
        '   MIT License, like the rest of BitKit. */\nwindow.BK_TEST_ROMS = ' + json.dumps(cards) + ';\n')
    if len(sys.argv) > 1:
        out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
        for k, v in roms.items(): (out / f'bitkit-test.{k}').write_bytes(v)
    print('test cards:', {k: len(v) for k, v in roms.items()})
