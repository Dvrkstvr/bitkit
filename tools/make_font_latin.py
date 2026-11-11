#!/usr/bin/env python3
"""Makes runtime/bk_font_latin.h: glyphs 0x80-0xFF for the 8x8 font, so text in German, French, Spanish and
other Latin-script languages draws (umlauts, accents, ß, ñ, ¿ ¡, «», €, œ...). The Bit's own text encoding is
Windows-1252: Latin-1 plus a few useful letters in 0x80-0x9F. Accented letters are built from the base letters
of runtime/bk_font.h with a mark above (capitals squeezed to 5 rows to make room), the rest are drawn here.
Run: python3 tools/make_font_latin.py"""
import re, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'runtime/bk_font.h')).read()
BASE = [[int(x, 16) for x in r.split(',')] for r in re.findall(r'\{(0x[0-9A-Fa-f]{2}(?:,0x[0-9A-Fa-f]{2}){7})\}', src)]
assert len(BASE) == 128

def rows(s):          # 8 strings of 8: '#' on, bit 0 = leftmost
    out = []
    for r in s.split():
        v = 0
        for i, ch in enumerate(r):
            if ch == '#': v |= 1 << i
        out.append(v)
    while len(out) < 8: out.append(0)
    return out
def shift(r, n): return [(v << n) & 0xFF if n >= 0 else v >> -n for v in r]

MARKS = {               # one row, sits on row 0 (row 1 stays empty) -- two rows for ^ ~ and the ring
    'grave': ['.##.....'], 'acute': ['...##...'], 'uml': ['##..##..'],
    'circ': ['..##....', '.#..#...'], 'tilde': ['.##.#...', '#.##....'], 'ring': ['.##.....', '.##.....'],
}
def mark(name, dx=0):
    m = [rows(x)[0] for x in MARKS[name]]
    return shift(m, dx)

def squeeze(g, n=5):    # a capital's 7 rows down to n: drop repeated rows first, then the ones most like a neighbour
    r = list(g[:7])
    while len(r) > n:
        best, bi = None, None
        for i in range(1, len(r) - 1):
            d = min(bin(r[i] ^ r[i - 1]).count('1'), bin(r[i] ^ r[i + 1]).count('1'))
            key = (d, abs(i - len(r) / 2))
            if best is None or key < best: best, bi = key, i
        r.pop(bi)
    return r

def lower(ch, m, dx=0):
    g = list(BASE[ord(ch)])
    if ch == 'i': g[0] = 0                      # the dot makes way for the mark
    mm = mark(m, dx)
    g[0] |= mm[0]
    if len(mm) > 1: g[1] |= mm[1]
    return g
def upper(ch, m, dx=0):
    body = squeeze(BASE[ord(ch)])
    mm = mark(m, dx)
    g = [mm[0], mm[1] if len(mm) > 1 else 0] + body + [0]
    return g
def cedilla(g):
    g = list(g); g[7] |= rows('..##....')[0]; return g

F = {}
A = 'grave acute circ tilde uml ring'.split()
for i, m in enumerate(A): F[0xC0 + i] = upper('A', m, 0 if m != 'ring' else 1)
for i, m in enumerate(A): F[0xE0 + i] = lower('a', m)
for i, m in enumerate(['grave', 'acute', 'circ', 'uml']):
    F[0xC8 + i] = upper('E', m, 1); F[0xE8 + i] = lower('e', m)
    F[0xCC + i] = upper('I', m, 0); F[0xEC + i] = lower('i', m)
    F[0xD9 + i] = upper('U', m, 0); F[0xF9 + i] = lower('u', m)
for i, m in enumerate(['grave', 'acute', 'circ', 'tilde', 'uml']):
    F[0xD2 + i] = upper('O', m, 1); F[0xF2 + i] = lower('o', m)
F[0xD1] = upper('N', 'tilde', 1); F[0xF1] = lower('n', 'tilde')
F[0xC7] = cedilla(BASE[ord('C')]); F[0xE7] = cedilla(BASE[ord('c')])
F[0xDD] = upper('Y', 'acute'); F[0xFD] = lower('y', 'acute')
F[0xFF] = lower('y', 'uml'); F[0x9F] = upper('Y', 'uml')

DRAWN = {
  0xA0: '', 0xAD: '........ ........ ........ ######.. ',
  0x80: '..####.. .##..##. ######.. .##..... ######.. .##..##. ..####.. ',          # €
  0x84: '........ ........ ........ ........ ........ .##.##.. .##.##.. ##.##... ',  # „
  0x85: '........ ........ ........ ........ ........ ........ ##.##.##',           # …
  0x91: '..##.... .##..... .##..... ', 0x92: '..##.... ..##.... .##..... ',
  0x93: '.##.##.. ##.##... ##.##... ', 0x94: '.##.##.. .##.##.. ##.##... ',
  0x82: '........ ........ ........ ........ ........ ..##.... ..##.... .##..... ',
  0x96: '........ ........ ........ ######.. ', 0x97: '........ ........ ........ ######## ',
  0x8C: '.######. ##.##... ##.##... ##.####. ##.##... ##.##... .######. ',          # Œ
  0x9C: '........ ........ .##.##.. ##.#.##. ##.####. ##.#.... .##.###. ',          # œ
  0x99: '###.#.#. .#.#.#.# .#.#...# ',                                                # ™
  0x95: '........ ........ ..##.... .####... .####... ..##.... ',                    # •
  0x8B: '........ ........ ...##... ..##.... .##..... ..##.... ...##... ',          # ‹
  0x9B: '........ ........ .##..... ..##.... ...##... ..##.... .##..... ',          # ›
  0x8A: '.##.##.. ..##.... .#####.. ##...... .####... ....##.. #####... ',          # Š
  0x9A: '.##.##.. ..##.... .#####.. ##...... .####... ....##.. #####... ',
  0x8E: '.##.##.. ..##.... ######.. ...##... ..##.... .##..... ######.. ',          # Ž
  0x9E: '.##.##.. ..##.... ######.. ...##... ..##.... .##..... ######.. ',
  0xA1: '..##.... ........ ..##.... ..##.... .####... .####... ..##.... ',          # ¡
  0xA2: '..##.... ..##.... .#####.. ##...... ##...... .#####.. ..##.... ..##.... ',
  0xA3: '..###... .##.##.. .##..... ####.... .##..... .##..##. ######.. ',          # £
  0xA4: '........ ##...##. .#####.. .##.##.. .#####.. ##...##. ',
  0xA5: '##..##.. ##..##.. .####... ######.. ..##.... ######.. ..##.... ',
  0xA6: '..##.... ..##.... ..##.... ........ ..##.... ..##.... ..##.... ',
  0xA7: '.####... ##...... .###.... ##..##.. .####... ....##.. .####... ',
  0xA8: '##..##.. ', 0xAF: '######.. ', 0xB4: '...##... ..##.... ', 0xB8: '........ ........ ........ ........ ........ ........ ..##.... .##..... ',
  0xA9: '.######. #......# #.###..# #.#....# #.###..# #......# .######. ',          # ©
  0xAE: '.######. #......# #.##...# #.#.#..# #.##...# #.#.#..# .######. ',          # ®
  0xAA: '.###.... ...#.... .###.... #..#.... .####... ........ ####.... ',
  0xBA: '.##..... #..#.... #..#.... .##..... ........ ####.... ',
  0xAB: '........ ..##.##. .##.##.. ##.##... .##.##.. ..##.##. ',                    # «
  0xBB: '........ ##.##... .##.##.. ..##.##. .##.##.. ##.##... ',                    # »
  0xAC: '........ ........ ######.. ....##.. ....##.. ',
  0xB0: '.###.... ##.##... .###.... ',                                                # °
  0xB1: '..##.... ..##.... ######.. ..##.... ..##.... ........ ######.. ',
  0xB2: '.###.... ...##... ..##.... .##..... .####... ', 0xB3: '####.... ..##.... ...##... ##.##... .###.... ',
  0xB9: '..##.... .###.... ..##.... ..##.... .####... ',
  0xB5: '........ ........ ##..##.. ##..##.. ##..##.. #####... ##...... ##...... ',
  0xB6: '.######. ####.##. ####.##. .###.##. ...#.##. ...#.##. ...#.##. ',
  0xB7: '........ ........ ........ ..##.... ..##.... ',
  0xBC: '#....#.. #...#... #..#.... ..#.#... .#.##... #.####.. ....#... ',
  0xBD: '#....#.. #...#... #..#.... ..#.##.. .#...#.. #...#... ....###. ',
  0xBE: '##...#.. .#..#... ##.#.... ..#.#... .#.##... #.####.. ....#... ',
  0xBF: '..##.... ........ ..##.... .##..... ##...... ##..##.. .####... ',          # ¿
  0xC6: '.######. ##.##... ##.##... #######. ##.##... ##.##... ##.####. ',          # Æ
  0xE6: '........ ........ ###.##.. ...##.#. .######. ##.##... .##.###. ',          # æ
  0xD0: '#####... .##.##.. .##..##. ####.##. .##..##. .##.##.. #####... ',          # Ð
  0xF0: '.##.#... ..##.... .#.##... .####... ##..##.. ##..##.. .####... ',          # ð
  0xD7: '........ ##...##. .##.##.. ..###... .##.##.. ##...##. ',                    # ×
  0xF7: '........ ..##.... ........ ######.. ........ ..##.... ',                    # ÷
  0xD8: '..####.# .##..##. ##..#.## ##.#..## ###...## .##..##. #.####.. ',          # Ø
  0xF8: '........ ......#. .####... ##.###.. ###.##.. .####... #....... ',          # ø
  0xDE: '####.... .##..... .#####.. .##..##. .#####.. .##..... ####.... ',          # Þ
  0xFE: '........ ###..... .#####.. .##..##. .##..##. .#####.. .##..... ####.... ', # þ
  0xDF: '.####... ##..##.. ##..##.. ##.##... ##..##.. ##..##.. ##.##... ',          # ß
}
for k, v in DRAWN.items(): F[k] = rows(v)

out = ['/* 8x8 glyphs 0x80-0xFF (Windows-1252: Latin-1 + a few), made by tools/make_font_latin.py from runtime/bk_font.h.',
       '   Bit 0 = leftmost pixel. Codes with no glyph draw as \'?\'. */',
       '#pragma once', '#include <stdint.h>',
       'static const uint8_t bk_font8x8_hi[128][8] = {']
QM = BASE[ord('?')]
for c in range(0x80, 0x100):
    g = F.get(c)
    has = 1 if g is not None else 0
    g = g if g is not None else QM
    out.append('  {%s},%s' % (','.join('0x%02X' % (v & 0xFF) for v in g), '' if has else '  /* none */'))
out.append('};')
out.append('')
open(os.path.join(ROOT, 'runtime/bk_font_latin.h'), 'w').write('\n'.join(out))
print('wrote runtime/bk_font_latin.h (%d glyphs)' % len(F))
