/* Two PocketBits linked over a socket pair instead of ESP-NOW, as two processes, with packets lost on purpose:
     bitsim --link <flash dir> <data dir> [--loss percent] [--game name] [-v]
   Bit A and Bit B find each other, A starts Crossgate (or the --game one) from its home screen and both play it in lockstep with
   random buttons; A's Start+Select pauses it on both on the same frame (the lockstep hash must match);
   A picks it again and both carry on; this time B leaves; then A opens Sweep Storm, B opens it by itself (NETGO)
   and both play it on their own and hear each other's net_send events; last, B switches off in the middle of a linked game and A goes home by itself.
   Included by main_sim.c. MIT License. */
#include <signal.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>

static const char *lk_game = "Crossgate";
static int lk_fd = -1, lk_loss = 0, lk_sent = 0, lk_lost = 0;
static uint64_t lk_rs;
static uint32_t lk_r(void) { lk_rs ^= lk_rs << 13; lk_rs ^= lk_rs >> 7; lk_rs ^= lk_rs << 17; return (uint32_t)lk_rs; }
static int lk_send(const void *p, int len) {
  lk_sent++;
  if ((int)(lk_r() % 100) < lk_loss) { lk_lost++; return 0; }   /* the radio lost it */
  return send(lk_fd, p, (size_t)len, MSG_DONTWAIT) == len ? 0 : 1;
}
static uint32_t lk_ms(void) { return (uint32_t)(now_us() / 1000.0); }
static void lk_drain(void) {
  uint8_t b[256];
  ssize_t n;
  while ((n = recv(lk_fd, b, sizeof(b), MSG_DONTWAIT)) > 0) bk_host_radio_recv(b, (int)n);
}
/* one frame at about 250 fps (both Bits wait for each other in a linked game anyway) */
static void lk_tick(uint16_t mask) { lk_drain(); tick(mask); usleep(4000); }
static uint16_t lk_rand_mask(void) {   /* random buttons, but never Select (Start+Select would leave) */
  uint16_t m = (uint16_t)(rnd() & 0xFFF) & (uint16_t)~SELECT;
  if (rnd() % 4) m &= (uint16_t)~START;
  return m;
}
/* run until cond() or the time is up; mask_fn gives the buttons */
static int lk_until(int (*cond)(void), uint16_t (*mask_fn)(void), double secs) {
  const double end = now_us() + secs * 1e6;
  while (now_us() < end) { if (cond()) return 1; lk_tick(mask_fn ? mask_fn() : 0); }
  return cond();
}
static uint16_t lk_none(void) { return 0; }
static uint16_t lk_combo(void) { return START | SELECT; }
static int lk_two(void) { return bk_host_linked() == 2; }
static int lk_ready(void) { return bk_host_link_ready() == 2 && !strcmp(bk_host_playing(), "home"); }   /* the other Bit is home too */
static int lk_in_sweep(void) { return !strcmp(bk_host_playing(), "Sweep Storm"); }
static int lk_in_game(void) { return bk_host_link_players() == 2; }
static int lk_at_home(void) { return !strcmp(bk_host_playing(), "home") && !bk_host_link_players(); }
static uint32_t lk_target;
static int lk_frame_reached(void) { uint32_t f; bk_host_link_sync(&f); return f >= lk_target || !bk_host_link_players(); }

static int link_bit(int is_a, const char *flash, const char *data, const char *result) {
  setup(flash, data);
  cfg.radio_send = lk_send;
  cfg.millis = lk_ms;
  cfg.bit_id = is_a ? 0x0A0A0A01u : 0x0B0B0B02u;
  rs ^= is_a ? 0x1234567u : 0x7654321u;
  if (bk_host_init(&cfg)) { FAIL("host did not start"); return 1; }
  const char *me = is_a ? "Bit A" : "Bit B";
  FILE *out = fopen(result, "w");
  uint32_t h1 = 0, f1 = 0, h2 = 0, f2 = 0;
  const int cross = find_game(lk_game), sweep = find_game("Sweep Storm");
  if (!cross || !sweep) { FAIL("%s: %s or Sweep Storm missing", me, lk_game); return 1; }

  /* 1. they find each other; then A starts Crossgate for both */
  if (!lk_until(lk_two, lk_none, 6)) FAIL("%s: never saw the other Bit", me);
  lk_until(lk_at_home, lk_none, 3);
  if (is_a) { if (!lk_until(lk_ready, lk_none, 6)) FAIL("Bit A: Bit B is not on its home screen"); bk_host_launch(cross); }
  if (!lk_until(lk_in_game, lk_none, 6)) FAIL("%s: the linked game did not start", me);
  /* 2. play in lockstep; A pauses with Start+Select after frame 600 */
  lk_target = 600;
  lk_until(lk_frame_reached, lk_rand_mask, 60);
  if (is_a) lk_until(lk_at_home, lk_combo, 10); else lk_until(lk_at_home, lk_rand_mask, 15);
  if (!lk_at_home()) FAIL("%s: Start+Select on Bit A did not take this Bit home", me);
  h1 = bk_host_link_sync(&f1);
  if (bk_host_paused_count() < 1) FAIL("%s: the linked game was not kept paused", me);
  /* 3. A picks it again: both carry on; B leaves this time */
  if (is_a) { if (!lk_until(lk_ready, lk_none, 6)) FAIL("Bit A: Bit B did not come home"); bk_host_launch(cross); }
  if (!lk_until(lk_in_game, lk_none, 6)) FAIL("%s: the paused linked game did not carry on", me);
  char carry[160];
  snprintf(carry, sizeof(carry), "carrying on with \"%s\" on 2 Bits", lk_game);
  if (!logged(carry)) FAIL("%s: carried on, but not from the paused copy (%s)", me, lastlog);
  lk_target = 300;
  lk_until(lk_frame_reached, lk_rand_mask, 60);
  if (!is_a) lk_until(lk_at_home, lk_combo, 10); else lk_until(lk_at_home, lk_rand_mask, 15);
  if (!lk_at_home()) FAIL("%s: Start+Select on Bit B did not take this Bit home", me);
  h2 = bk_host_link_sync(&f2);
  /* 4. Sweep Storm: A opens it, B opens it by itself (NETGO) straight into its lobby, not in lockstep;
     each Bit plays on its own, talking with net_send */
  if (is_a) { if (!lk_until(lk_ready, lk_none, 6)) FAIL("Bit A: Bit B is not home for Sweep Storm"); bk_host_launch(sweep); }
  else if (!lk_until(lk_in_sweep, lk_none, 8)) FAIL("Bit B: Sweep Storm on Bit A did not open it here (%s)", bk_host_playing());
  if (bk_host_link_players()) FAIL("%s: Sweep Storm was started in lockstep", me);
  { const double t = now_us() + 3.0e6; while (now_us() < t) lk_tick(lk_rand_mask() & (uint16_t)~START); }
  if (bk_host_net_heard() < 1) FAIL("%s: heard no net_send events from the other Bit", me);
  bk_host_go_home();
  /* 5. a linked game again; B switches off after a moment and A has to notice */
  if (is_a) { if (!lk_until(lk_ready, lk_none, 6)) FAIL("Bit A: Bit B did not leave Sweep Storm"); bk_host_launch(cross); }
  if (!lk_until(lk_in_game, lk_none, 6)) FAIL("%s: the third linked game did not start", me);
  if (!is_a) { const double t = now_us() + 1.0e6; while (now_us() < t) lk_tick(lk_rand_mask()); }
  else {
    if (!lk_until(lk_at_home, lk_rand_mask, 12)) FAIL("Bit A: still in the game after Bit B switched off");
    if (bk_host_linked() != 1) FAIL("Bit A: still sees Bit B");
  }
  fprintf(out, "%08x %u %08x %u %d %d %d\n", h1, f1, h2, f2, bk_host_net_heard(), lk_sent, lk_lost);
  fclose(out);
  bk_host_shutdown();
  return fails;
}

static int link_test(int argc, char **argv) {
  const char *flash = argv[2], *data = argv[3];
  for (int i = 4; i < argc; i++) {
    if (!strcmp(argv[i], "--loss") && i + 1 < argc) lk_loss = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--game") && i + 1 < argc) lk_game = argv[++i];
    else if (!strcmp(argv[i], "-v")) verbose = 1;
  }
  printf("linked game: %s\n", lk_game);
  char da[600], db[600], ra[700], rb[700];
  snprintf(da, sizeof(da), "%s/bit-a", data); snprintf(db, sizeof(db), "%s/bit-b", data);
  mkdir(data, 0755);
  snprintf(ra, sizeof(ra), "%s/result-a.txt", data); snprintf(rb, sizeof(rb), "%s/result-b.txt", data);
  remove(ra); remove(rb);
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_DGRAM, 0, sv)) { perror("socketpair"); return 1; }
  fflush(NULL);
  const pid_t pid = fork();
  if (pid == 0) {
    close(sv[0]); lk_fd = sv[1]; lk_rs = 0x9E3779B97F4A7C15ull ^ (uint64_t)time(NULL) * 2654435761u;
    _exit(link_bit(0, flash, db, rb) ? 1 : 0);
  }
  close(sv[1]); lk_fd = sv[0]; lk_rs = 0xD1B54A32D192ED03ull ^ (uint64_t)time(NULL);   /* a different loss pattern every run */
  int ra_fail = link_bit(1, flash, da, ra);
  int st = 0;
  waitpid(pid, &st, 0);
  const int rb_fail = !WIFEXITED(st) || WEXITSTATUS(st);
  unsigned ha1 = 0, fa1 = 0, ha2 = 0, fa2 = 0, hb1 = 1, fb1 = 1, hb2 = 1, fb2 = 1; int na = 0, nb = 0, sa = 0, la = 0, sb = 0, lb = 0;
  FILE *f = fopen(ra, "r"); if (!f || fscanf(f, "%x %u %x %u %d %d %d", &ha1, &fa1, &ha2, &fa2, &na, &sa, &la) != 7) FAIL("no result from Bit A"); if (f) fclose(f);
  f = fopen(rb, "r"); if (!f || fscanf(f, "%x %u %x %u %d %d %d", &hb1, &fb1, &hb2, &fb2, &nb, &sb, &lb) != 7) FAIL("no result from Bit B"); if (f) fclose(f);
  printf("lockstep game 1: Bit A %u frames hash %08x, Bit B %u frames hash %08x\n", fa1, ha1, fb1, hb1);
  printf("lockstep game 2 (carried on): Bit A %u frames hash %08x, Bit B %u frames hash %08x\n", fa2, ha2, fb2, hb2);
  printf("net_send events heard: Bit A %d, Bit B %d; packets sent %d + %d, lost on purpose %d + %d (%d%%)\n", na, nb, sa, sb, la, lb, lk_loss);
  if (fa1 != fb1 || ha1 != hb1 || fa1 < 600) FAIL("game 1 out of step");
  if (fa2 != fb2 || ha2 != hb2 || fa2 < 300) FAIL("game 2 out of step");
  if (ra_fail || rb_fail || fails) { fprintf(stderr, "linked Bits test failed\n"); return 1; }
  printf("ok: two linked Bits found each other, played in lockstep, paused and carried on together, talked with net_send, and noticed a Bit switching off\n");
  return 0;
}
