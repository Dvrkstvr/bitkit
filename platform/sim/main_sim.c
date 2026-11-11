/* Headless PocketBit: the device host (platform/device) on a computer, no screen or sound.
   CI uses it to play every built-in game and app through the same C code the ESP32-S3 firmware runs:
     bitsim --test <flash dir> <data dir> [--frames N] [--report file.md] [--shots dir]
   <flash dir> is what tools/export_device.cjs writes (carts/, apps/, sys/home.lua). MIT License. */
#include "bk_host.h"
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

static int fails = 0, verbose = 0;
static char lastlog[2048];
static char logs[64][256];
static int nlogs;
#define FAIL(...) do { fprintf(stderr, "FAIL "); fprintf(stderr, __VA_ARGS__); fprintf(stderr, "\n"); fails++; } while (0)

static void logger(const char *m, int err) {
  snprintf(lastlog, sizeof(lastlog), "%s", m);
  snprintf(logs[nlogs % 64], sizeof(logs[0]), "%s", m); nlogs++;
  if (verbose || err) fprintf(stderr, "%s%s\n", err ? "  [error] " : "  ", m);
}
static int logged(const char *prefix) {
  for (int i = nlogs > 64 ? nlogs - 64 : 0; i < nlogs; i++) if (!strncmp(logs[i % 64], prefix, strlen(prefix))) return 1;
  return 0;
}
static const char *find_log(const char *prefix) {
  for (int i = nlogs - 1; i >= 0 && i >= nlogs - 64; i--) if (!strncmp(logs[i % 64], prefix, strlen(prefix))) return logs[i % 64];
  return NULL;
}
static double now_us(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e6 + t.tv_nsec / 1e3; }

static uint64_t rs = 88172645463325252ull;
static uint32_t rnd(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return (uint32_t)rs; }

static uint16_t frame_buf[BK_W * 24];
static double present_us;
/* one tick as the firmware does it: frame, sound, then the picture in bands */
static int tick(uint16_t mask) {
  int r = bk_host_frame(mask, NULL);
  int16_t snd[735 * 2];
  bk_host_audio(snd, 735);
  double t0 = now_us();
  bk_host_present_begin();
  for (int y = 0; y < BK_H; y += 24) bk_present_rgb565(frame_buf, y, y + 24);
  present_us += now_us() - t0;
  return r;
}
static void ticks(int n, uint16_t mask) { for (int i = 0; i < n; i++) tick(mask); }
static const uint16_t A = 1 << BK_A, START = 1 << BK_START, SELECT = 1 << BK_SELECT, RIGHT = 1 << BK_RIGHT;

static void shot(const char *dir, const char *name) {
  if (!dir) return;
  char p[512]; snprintf(p, sizeof(p), "%s/%s.ppm", dir, name);
  for (char *c = p + strlen(dir) + 1; *c; c++) if (*c == ' ') *c = '-';
  FILE *f = fopen(p, "wb");
  if (!f) return;
  fprintf(f, "P6\n%d %d\n255\n", BK_W, BK_H);
  bk_host_present_begin();
  for (int y = 0; y < BK_H; y++) {
    uint16_t row[BK_W];
    bk_present_rgb565(row, y, y + 1);
    for (int x = 0; x < BK_W; x++) { unsigned char px[3] = { (unsigned char)((row[x] >> 11) << 3), (unsigned char)(((row[x] >> 5) & 63) << 2), (unsigned char)((row[x] & 31) << 3) }; fwrite(px, 1, 3, f); }
  }
  fclose(f);
}

static int count_files(const char *dir, const char *ext) {
  DIR *d = opendir(dir); if (!d) return 0;
  int n = 0; struct dirent *e;
  while ((e = readdir(d))) { size_t l = strlen(e->d_name), k = strlen(ext); if (l > k && !strcmp(e->d_name + l - k, ext)) n++; }
  closedir(d);
  return n;
}
static void write_file(const char *path, const char *text) { FILE *f = fopen(path, "wb"); if (f) { fputs(text, f); fclose(f); } }

static bk_host_config cfg;
static char p_home[512], p_carts[512], p_apps[512], p_saves[512], p_extra[512], p_caps[512];
static void setup(const char *flash, const char *data) {
  snprintf(p_home, sizeof(p_home), "%s/sys/home.lua", flash);
  snprintf(p_carts, sizeof(p_carts), "%s/carts", flash);
  snprintf(p_apps, sizeof(p_apps), "%s/apps", flash);
  snprintf(p_saves, sizeof(p_saves), "%s/saves", data);
  snprintf(p_extra, sizeof(p_extra), "%s/games", data);
  snprintf(p_caps, sizeof(p_caps), "%s/captures", data);
  mkdir(data, 0755); mkdir(p_saves, 0755); mkdir(p_extra, 0755); mkdir(p_caps, 0755);
  memset(&cfg, 0, sizeof(cfg));
  cfg.home_lua = p_home;
  cfg.game_dirs[0] = p_extra; cfg.game_dirs[1] = p_carts;
  cfg.app_dirs[0] = p_apps;
  cfg.save_dir = p_saves;
  cfg.captures_dir = p_caps;
  cfg.source = "";
  cfg.max_paused = 4;
  cfg.log = logger;
}
static int find_game(const char *name) {
  for (int i = 1; i <= bk_host_games(); i++) if (!strcmp(bk_host_game_name(i), name)) return i;
  return 0;
}

typedef struct { char name[64]; double avg, max; size_t peak; int err; } perf;

int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[1], "--test")) {
    fprintf(stderr, "usage: bitsim --test <flash dir> <data dir> [--frames N] [--report file.md] [--shots dir] [-v]\n");
    return 2;
  }
  const char *flash = argv[2], *data = argv[3], *report = NULL, *shots = NULL;
  int frames = 900;
  for (int i = 4; i < argc; i++) {
    if (!strcmp(argv[i], "--frames") && i + 1 < argc) frames = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--report") && i + 1 < argc) report = argv[++i];
    else if (!strcmp(argv[i], "--shots") && i + 1 < argc) { shots = argv[++i]; mkdir(shots, 0755); }
    else if (!strcmp(argv[i], "-v")) verbose = 1;
  }
  setup(flash, data);
  /* a clean memory card: no saves or captures from an earlier run, no broken test cart yet */
  { char p[1100]; const char *dirs[2] = { p_saves, p_caps };
    for (int k = 0; k < 2; k++) {
      DIR *d = opendir(dirs[k]); struct dirent *e;
      while (d && (e = readdir(d))) if (e->d_name[0] != '.') { snprintf(p, sizeof(p), "%s/%s", dirs[k], e->d_name); remove(p); }
      if (d) closedir(d);
    }
    snprintf(p, sizeof(p), "%s/zz-broken.bitkit", p_extra); remove(p); }

  /* 1. boot: home screen with every game and app */
  if (bk_host_init(&cfg)) { FAIL("host did not start"); return 1; }
  const int ngames = count_files(p_carts, ".bitkit"), napps = count_files(p_apps, ".bitkit");
  if (strcmp(bk_host_playing(), "home")) FAIL("did not boot into the home screen (%s)", bk_host_playing());
  if (bk_host_games() != ngames + napps) FAIL("home screen lists %d entries, expected %d games + %d apps", bk_host_games(), ngames, napps);
  ticks(30, 0);
  shot(shots, "home");

  /* 2. home screen by buttons: Right then A starts the second game; Start+Select pauses it and goes home */
  ticks(2, RIGHT); ticks(4, 0); ticks(2, A); ticks(4, 0);
  if (strcmp(bk_host_playing(), bk_host_game_name(2))) FAIL("Right + A on the home screen should start \"%s\", playing \"%s\"", bk_host_game_name(2), bk_host_playing());
  ticks(60, 0);
  ticks(2, START | SELECT); ticks(2, 0);
  if (strcmp(bk_host_playing(), "home") || bk_host_paused_count() != 1) FAIL("Start+Select should pause the game and go home (playing %s, %d paused)", bk_host_playing(), bk_host_paused_count());

  /* photos and clips: Select+L, Select+R (start), Select+R (stop) */
  bk_host_launch(1); ticks(30, 0);
  ticks(2, SELECT); ticks(2, SELECT | (1 << BK_L)); ticks(2, 0);
  ticks(2, SELECT); ticks(2, SELECT | (1 << BK_R)); ticks(2, 0);
  ticks(90, 0);
  ticks(2, SELECT); ticks(2, SELECT | (1 << BK_R)); ticks(2, 0);
  if (count_files(p_caps, ".png") != 1 || count_files(p_caps, ".gif") != 1 || bk_host_recording())
    FAIL("Select+L / Select+R should save one photo and one clip (%d png, %d gif)", count_files(p_caps, ".png"), count_files(p_caps, ".gif"));
  bk_host_go_home();

  /* 3. every game and app: play with random buttons, pause, carry on */
  perf P[128]; int np = 0;
  for (int g = 1; g <= bk_host_games() && np < 128; g++) {
    perf *p = &P[np++];
    memset(p, 0, sizeof(*p));
    snprintf(p->name, sizeof(p->name), "%s", bk_host_game_name(g));
    if (bk_host_launch(g) || strcmp(bk_host_playing(), p->name)) { FAIL("%s did not start: %s", p->name, bk_host_last_error()); p->err = 1; bk_host_go_home(); continue; }
    double sum = 0, mx = 0; int n = 0;
    uint16_t held = 0;
    for (int f = 0; f < frames; f++) {
      if (f % 6 == 0) {   /* a new random handful of buttons every few frames; never Start+Select or Start */
        uint32_t r = rnd();
        held = (uint16_t)(r & ((1 << BK_START) - 1));
        if ((r >> 20) % 3 == 0) held = 0;
        if (f < 120 && f % 30 < 6) held = A;     /* get past title screens */
      }
      double t0 = now_us();
      int r = bk_host_frame(held, NULL);
      double dt = now_us() - t0;
      int16_t snd[735 * 2]; bk_host_audio(snd, 735);
      if (r || !strcmp(bk_host_playing(), "error")) { FAIL("%s stopped at frame %d: %s", p->name, f, bk_host_last_error()); p->err = 1; break; }
      if (strcmp(bk_host_playing(), p->name)) break;   /* the game went home itself (a menu item) */
      if (f > 10) { sum += dt; n++; if (dt > mx) mx = dt; }
    }
    p->avg = n ? sum / n : 0; p->max = mx; p->peak = bk_host_lua_peak();
    if (p->err) { ticks(2, 0); ticks(2, A); ticks(2, 0); continue; }
    shot(shots, p->name);
    /* pause and carry on: the game's own frame counter keeps going */
    if (!strcmp(bk_host_playing(), p->name)) {
      uint32_t fr = BK->frame;
      ticks(2, START | SELECT); ticks(2, 0);
      if (strcmp(bk_host_playing(), "home")) FAIL("%s: Start+Select did not go home", p->name);
      bk_host_launch(g);
      ticks(3, 0);
      if (strcmp(bk_host_playing(), p->name) || BK->frame < fr) FAIL("%s did not carry on after a pause (frame %u, was %u)", p->name, BK->frame, fr);
      bk_host_go_home();
    }
    if (bk_host_paused_count() > cfg.max_paused) FAIL("%d games paused, the limit is %d", bk_host_paused_count(), cfg.max_paused);
  }
  if (count_files(p_saves, ".sav") == 0) FAIL("no game wrote a save file");

  /* 4. levels and the game shell's restart (Sprout Hop has two levels) */
  int sprout = find_game("Sprout Hop");
  if (sprout) {
    bk_host_launch(sprout); ticks(2, 0);
    ticks(30, 0);
    bk_host_restart(3); ticks(1, 0);   /* the game shell's _restart(3): straight into play */
    if (strcmp(bk_host_playing(), "Sprout Hop") || BK->frame > 1) FAIL("_restart() did not start Sprout Hop again (frame %u)", BK->frame);
    /* level() asks the host for the map during a frame, as a game does */
    bk_host_eval("level(2)"); ticks(3, 0);
    bk_host_eval("print('lvl', LEVEL, mget(0, 0))");
    const char *l = find_log("lvl");
    if (!l || strcmp(l, "lvl\t2\t18")) FAIL("level(2) on the device: %s (expected level 2, brick tile 18 at 0,0)", l ? l : "nothing");
    bk_host_go_home();
  } else FAIL("Sprout Hop is not on the Bit");

  /* 5. the Bit's settings: the Settings app saves them, the Bit uses them at once and after a restart */
  int settings = find_game("Settings");
  if (settings) {
    bk_host_launch(settings); ticks(2, 0);
    bk_host_eval("save({look = 'sepia', strength = 10, bright = 4, volume = 5})"); ticks(2, 0);
    const bk_bit_settings *s = bk_host_settings();
    if (strcmp(s->look, "sepia") || s->bright != 4 || s->volume != 5) FAIL("Bit settings not read after the Settings app saved them (%s %d %d)", s->look, s->bright, s->volume);
    if (bk_host_backlight() != 610) FAIL("backlight for brightness 4 is %d per mille, expected 610", bk_host_backlight());
    bk_host_go_home();
    bk_host_init(&cfg);
    if (strcmp(bk_host_settings()->look, "sepia")) FAIL("Bit settings were not kept after a restart");
    /* the look goes over the picture, not into the game's own display{} */
    ticks(5, 0);
    int32_t own = BK->display.sat;
    bk_host_present_begin(); uint16_t a[BK_W]; bk_present_rgb565(a, 120, 121);
    if (BK->display.sat != own) FAIL("the Bit's look changed the game's own display values");
    bk_host_eval("save({look = 'game', strength = 10, bright = 10, volume = 10})");
  } else FAIL("the Settings app is not on the Bit");

  /* 6. a broken game shows its error and A goes back home */
  { char p[600]; snprintf(p, sizeof(p), "%s/zz-broken.bitkit", p_extra);
    write_file(p, "{\"format\":\"bitkit-cart\",\"version\":1,\"name\":\"Broken\",\"code\":\"function _update() if t() == 5 then error('boom') end end\",\"entities_lua\":\"\"}"); }
  bk_host_init(&cfg);
  int broken = find_game("Broken");
  if (!broken) FAIL("a game from the second folder is not listed");
  else {
    bk_host_launch(broken); ticks(10, 0);
    if (strcmp(bk_host_playing(), "error") || !strstr(bk_host_last_error(), "boom")) FAIL("a Lua error should show the error screen (%s: %s)", bk_host_playing(), bk_host_last_error());
    shot(shots, "error");
    ticks(2, A); ticks(2, 0);
    if (strcmp(bk_host_playing(), "home")) FAIL("A on the error screen should go home (%s)", bk_host_playing());
  }
  { char p[600]; snprintf(p, sizeof(p), "%s/zz-broken.bitkit", p_extra); remove(p); }

  /* 7. a game that needs more memory than it may have stops with a message, not a crash */
  cfg.game_mem_limit = 96 * 1024;
  bk_host_init(&cfg);
  int big = find_game("Kart Lab");
  if (big) {
    bk_host_launch(big); ticks(5, 0);
    if (strcmp(bk_host_playing(), "error") || !strstr(bk_host_last_error(), "memory")) FAIL("a game over its memory limit should stop with a memory error (%s: %s)", bk_host_playing(), bk_host_last_error());
    ticks(2, A); ticks(2, 0);
  }
  cfg.game_mem_limit = 0;

  /* report */
  FILE *rf = report ? fopen(report, "w") : NULL;
  if (rf) {
    fprintf(rf, "| Game | avg ms/frame (host) | max ms | Lua peak KB |\n|---|---:|---:|---:|\n");
    for (int i = 0; i < np; i++) fprintf(rf, "| %s | %.3f | %.2f | %zu |\n", P[i].name, P[i].avg / 1000, P[i].max / 1000, P[i].peak / 1024);
    fclose(rf);
  }
  printf("%-16s %10s %9s %9s\n", "game", "avg ms", "max ms", "Lua KB");
  for (int i = 0; i < np; i++) printf("%-16s %10.3f %9.2f %9zu%s\n", P[i].name, P[i].avg / 1000, P[i].max / 1000, P[i].peak / 1024, P[i].err ? "  ERROR" : "");
  if (fails) { printf("%d check(s) failed\n", fails); return 1; }
  printf("ok: device host played %d games and apps for %d frames each: home screen, pause and carry on, saves, levels, restart, Bit settings, errors, memory limit\n", np, frames);
  return 0;
}
