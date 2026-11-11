/*
 * BitKit emulators on a device: ROMs, battery saves and save states as plain files in one folder
 * (the PocketBit's SD card: /sdcard/roms). Uses only stdio and dirent, so it also runs on a desktop
 * (the native tests use it).
 *
 *   /sdcard/roms/Tetris.gb            a ROM (.gb, .gbc or .nes), here or in a subfolder gb/, gbc/ or nes/
 *   /sdcard/roms/Tetris.sav           its battery save (the cartridge's RAM)
 *   /sdcard/roms/Tetris.st1 .. .st9   its save states
 *
 * Firmware: call bk_emu_fs_init("/sdcard/roms") once at boot. Everything else happens through the hooks.
 * MIT License - see LICENSE.
 */
#include "bk_emu.h"
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define FS_MAX 512
typedef struct { char rel[128]; int kind; uint32_t size; } fs_rom;
static char fs_root[128];
static fs_rom *fs_list;            /* every ROM found by the last scan */
static int fs_n;
static int fs_pick[FS_MAX];        /* the last list given to the app: its entries as indexes into fs_list */
static int fs_npick;

static int kind_of(const char *name) {
  const char *e = strrchr(name, '.');
  if (!e) return 0;
  char x[5] = {0};
  for (int i = 0; i < 4 && e[i + 1]; i++) x[i] = (char)(e[i + 1] | 0x20);
  if (!strcmp(x, "gb")) return BK_EMU_GB;
  if (!strcmp(x, "gbc") || !strcmp(x, "cgb")) return BK_EMU_GBC;
  if (!strcmp(x, "nes")) return BK_EMU_NES;
  return 0;
}
static void path(char *out, size_t n, const char *rel, const char *ext) {
  /* rel without its extension, plus ext (or rel as it is when ext is NULL) */
  if (!ext) { snprintf(out, n, "%s/%s", fs_root, rel); return; }
  char base[128];
  snprintf(base, sizeof(base), "%s", rel);
  char *dot = strrchr(base, '.');
  if (dot) *dot = 0;
  snprintf(out, n, "%s/%s%s", fs_root, base, ext);
}
static int exists(const char *p) { struct stat st; return stat(p, &st) == 0; }

static void scan_dir(const char *sub) {
  char dir[256];
  if (sub[0]) snprintf(dir, sizeof(dir), "%s/%s", fs_root, sub); else snprintf(dir, sizeof(dir), "%s", fs_root);
  DIR *d = opendir(dir);
  if (!d) return;
  struct dirent *e;
  while ((e = readdir(d)) && fs_n < FS_MAX) {
    if (e->d_name[0] == '.') continue;
    int k = kind_of(e->d_name);
    if (!k) continue;
    fs_rom *r = &fs_list[fs_n];
    size_t ls = strlen(sub), ln = strlen(e->d_name);
    if (ls + ln + 2 > sizeof(r->rel)) continue;          /* a name this long is skipped */
    if (ls) { memcpy(r->rel, sub, ls); r->rel[ls] = '/'; memcpy(r->rel + ls + 1, e->d_name, ln + 1); }
    else memcpy(r->rel, e->d_name, ln + 1);
    char p[320]; path(p, sizeof(p), r->rel, NULL);
    struct stat st;
    if (stat(p, &st) != 0 || !S_ISREG(st.st_mode)) continue;
    r->kind = k; r->size = (uint32_t)st.st_size;
    fs_n++;
  }
  closedir(d);
}
static int by_name(const void *a, const void *b) {
  const char *x = strrchr(((const fs_rom *)a)->rel, '/'), *y = strrchr(((const fs_rom *)b)->rel, '/');
  x = x ? x + 1 : ((const fs_rom *)a)->rel; y = y ? y + 1 : ((const fs_rom *)b)->rel;
  for (; *x && *y; x++, y++) { int c = (*x | 0x20) - (*y | 0x20); if (c) return c; }
  return *x - *y;
}
static void scan(void) {
  if (!fs_list) fs_list = (fs_rom *)malloc(sizeof(fs_rom) * FS_MAX);
  fs_n = 0;
  if (!fs_list) return;
  scan_dir(""); scan_dir("gb"); scan_dir("gbc"); scan_dir("nes");
  qsort(fs_list, (size_t)fs_n, sizeof(fs_rom), by_name);
}

/* a Lua string literal */
static size_t lua_str(char *o, const char *s) {
  size_t n = 0;
  o[n++] = '"';
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { o[n++] = '\\'; o[n++] = (char)c; }
    else if (c < 32) o[n++] = ' ';
    else o[n++] = (char)c;
  }
  o[n++] = '"';
  return n;
}
static char *fs_roms(const char *kind) {
  static const char *KN[] = {"", "gb", "gbc", "nes"};
  scan();
  fs_npick = 0;
  char *out = (char *)malloc((size_t)fs_n * 512 + 8);
  if (!out) return NULL;
  size_t n = 0;
  out[n++] = '{';
  for (int i = 0; i < fs_n; i++) {
    fs_rom *r = &fs_list[i];
    if (kind && kind[0] && strcmp(kind, KN[r->kind])) continue;
    fs_pick[fs_npick++] = i;
    const char *base = strrchr(r->rel, '/');
    char name[128];
    snprintf(name, sizeof(name), "%s", base ? base + 1 : r->rel);
    char *dot = strrchr(name, '.'); if (dot) *dot = 0;
    char p[320];
    n += (size_t)sprintf(out + n, "{name=");
    n += lua_str(out + n, name);
    path(p, sizeof(p), r->rel, ".sav");
    n += (size_t)sprintf(out + n, ",kind=\"%s\",size=%u,save=%s,states={", KN[r->kind], (unsigned)r->size, exists(p) ? "true" : "false");
    for (int s = 1; s <= 9; s++) {
      char ext[5]; snprintf(ext, sizeof(ext), ".st%d", s);
      path(p, sizeof(p), r->rel, ext);
      if (exists(p)) n += (size_t)sprintf(out + n, "[%d]=true,", s);
    }
    n += (size_t)sprintf(out + n, "}},");
  }
  out[n++] = '}'; out[n] = 0;
  return out;
}
static const fs_rom *by_save_name(const char *name) {
  for (int i = 0; i < fs_n; i++) if (!strcmp(fs_list[i].rel, name)) return &fs_list[i];
  return NULL;
}
static uint8_t *read_all(const char *p, uint32_t *len) {
  FILE *f = fopen(p, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  uint8_t *b = n > 0 ? (uint8_t *)malloc((size_t)n) : NULL;
  if (b && fread(b, 1, (size_t)n, f) != (size_t)n) { free(b); b = NULL; }
  fclose(f);
  if (b) *len = (uint32_t)n;
  return b;
}
static void write_all(const char *p, const uint8_t *d, uint32_t len) {
  char tmp[330];
  snprintf(tmp, sizeof(tmp), "%s.tmp", p);
  FILE *f = fopen(tmp, "wb");
  if (!f) return;
  int ok = fwrite(d, 1, len, f) == len;
  ok = (fclose(f) == 0) && ok;
  if (ok) { remove(p); rename(tmp, p); } else remove(tmp);
}
static void fs_open(int index) {
  if (index < 1 || index > fs_npick) { bk_emu_notify("open", 0); return; }
  const fs_rom *r = &fs_list[fs_pick[index - 1]];
  char p[320]; path(p, sizeof(p), r->rel, NULL);
  FILE *f = fopen(p, "rb");
  uint8_t *buf = f ? bk_emu_rom_alloc(r->size) : NULL;
  int ok = buf && fread(buf, 1, r->size, f) == r->size;
  if (f) fclose(f);
  ok = ok && bk_emu_start(r->rel);           /* the save name is the file's path in the folder */
  if (ok) {
    uint32_t want = 0, got = 0;
    uint8_t *ram = bk_emu_sram(&want);
    path(p, sizeof(p), r->rel, ".sav");
    uint8_t *sav = ram ? read_all(p, &got) : NULL;
    if (sav) { memcpy(ram, sav, got < want ? got : want); free(sav); bk_emu_sram_loaded(); }
  }
  bk_emu_notify("open", ok);
}
static void fs_sram(const char *name, const uint8_t *data, uint32_t len) {
  const fs_rom *r = by_save_name(name);
  if (!r) return;
  char p[320]; path(p, sizeof(p), r->rel, ".sav");
  write_all(p, data, len);
}
static void fs_state_save(const char *name, int slot, const uint8_t *data, uint32_t len) {
  const fs_rom *r = by_save_name(name);
  if (!r) return;
  char ext[5], p[320]; snprintf(ext, sizeof(ext), ".st%d", slot);
  path(p, sizeof(p), r->rel, ext);
  write_all(p, data, len);
}
static void fs_state_load(const char *name, int slot) {
  const fs_rom *r = by_save_name(name);
  uint32_t len = 0;
  uint8_t *d = NULL;
  if (r) { char ext[5], p[320]; snprintf(ext, sizeof(ext), ".st%d", slot); path(p, sizeof(p), r->rel, ext); d = read_all(p, &len); }
  int ok = d && bk_emu_state_load(d, len);
  free(d);
  bk_emu_notify("load", ok);
}

void bk_emu_fs_init(const char *root) {
  snprintf(fs_root, sizeof(fs_root), "%s", root);
  size_t n = strlen(fs_root);
  while (n > 1 && fs_root[n - 1] == '/') fs_root[--n] = 0;
  static const bk_emu_host h = {fs_roms, fs_open, fs_sram, fs_state_save, fs_state_load};
  bk_emu_set_host(&h);
}
