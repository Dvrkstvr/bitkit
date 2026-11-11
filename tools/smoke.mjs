// Headless smoke test: loads the WASM runtime in Node and runs a cart.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const factory = require('../studio/runtime.js');
const M = await factory({ onLog: (m, e) => console.log(e ? 'ERR' : 'LOG', m) });
M._bkw_init();
const code = `
x=0
function _init() print("hello", rnd(10), math.random(1,6)) end
function _update() if btn("a") then x=x+1 end end
function _draw() cls(1) rectfill(x,10,20,20,9) text("Hi "..press("l"),0,0) circ(100,100,20,12) spr(1,0,0,2,2) map() end`;
const p = M.stringToNewUTF8(code);
console.log('load', M._bkw_load(p));
const press = M._malloc(12); M.HEAPU8.fill(0, press, press+12); M.HEAPU8[press+8]=128;
for (let i=0;i<10;i++) M._bkw_frame(1<<4, press);
const rgba = M._bkw_render()>>2;
console.log('px(15,15)=', M.HEAPU32[rgba+15*320+15].toString(16), 'px(0,239)=', M.HEAPU32[rgba+239*320].toString(16));
console.log('loop test', M._bkw_load(M.stringToNewUTF8('function _update() while true do end end')), M._bkw_frame(0,press));
console.log('syntax test', M._bkw_load(M.stringToNewUTF8('function (')));
const a = M._bkw_audio(512);
