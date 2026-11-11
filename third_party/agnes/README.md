# agnes

NES emulation for BitKit's emulator apps (runtime/bk_emu.c includes `agnes.c`).

[agnes](https://github.com/kgabis/agnes) by Krzysztof Gabis (MIT, `LICENSE`), commit 0e4220b084c467e39c04805d955e78c463feadd0.
Mappers 0 (NROM), 1 (MMC1), 2 (UxROM) and 4 (MMC3).

One change: agnes has no sound chip, so its CPU now calls `AGNES_APU_WRITE` / `AGNES_APU_READ` for $4000-$4017
(marked "BitKit" in `agnes.c`; they do nothing unless the includer defines them). BitKit's own NES sound chip is in
runtime/bk_emu.c.
