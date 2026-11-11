# Walnut-CGB and minigb_apu

Game Boy and Game Boy Color emulation for BitKit's emulator apps (runtime/bk_emu.c includes these files).

- `walnut_cgb.h`: [Walnut-CGB](https://github.com/Mr-PauI/Walnut-CGB) by Mr-PauI (MIT, `LICENSE`), commit
  a42c186917516cc9c80515ceae1121600a071628. Based on [Peanut-GB](https://github.com/deltabeard/Peanut-GB) by
  Mahyar Koshkouei (MIT), with parts from [SameBoy](https://github.com/LIJI32/SameBoy) by Lior Halphon (MIT).
- `minigb_apu.c`, `minigb_apu.h`: the Game Boy sound chip, from Walnut-CGB's `examples/sdl2/minigb_apu`, by
  Alex Baines and Mahyar Koshkouei (MIT, `LICENSE.minigb_apu`), based on [MiniGBS](https://github.com/baines/MiniGBS).

Unchanged from upstream.
