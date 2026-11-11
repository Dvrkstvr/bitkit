/* Two PocketBits sharing with the Share app over a lossy socket radio (instead of ESP-NOW), as two processes:
     bitsim --share <flash dir> <data dir> [--loss percent] [-v]
   Bit A has a game of its own (Crossgate, as a file on its card) and a photo. Both open Share from the Utilities
   row; A sends the game to B, B says yes and gets the very same bytes, on its home screen at once; then the photo;
   then B says no to one; then A stops one half way. Included by main_sim.c, after link_sim.c. MIT License. */

static int sh_find_app(void) { for (int i = 1; i <= bk_host_games(); i++) if (!strcmp(bk_host_game_name(i), "Share")) return i; return 0; }
static int sh_in_app(void) { return !strcmp(bk_host_playing(), "Share"); }
/* ask like the app does; the host acts on it next frame and then writes SHARE again, so give it two */
static int sh_req(int op, int a, int b) { char l[64]; snprintf(l, sizeof(l), "share(%d, %d, %d)", op, a, b); const int r = bk_host_eval(l); lk_tick(0); lk_tick(0); return r; }
/* read SHARE in the app: returns the number print()ed by expr */
static double sh_val(const char *expr) {
  char l[300]; snprintf(l, sizeof(l), "print('@' .. tostring(%s))", expr);
  nlogs = 0; bk_host_eval(l);
  const char *s = find_log("@");
  if (!s || !strcmp(s + 1, "nil") || !strcmp(s + 1, "false")) return 0;
  char *end; const double v = strtod(s + 1, &end);
  return end != s + 1 ? v : 1;                                   /* true, a table, a string: there */
}
static const char *sh_str(const char *expr) {
  static char out[128]; char l[300]; snprintf(l, sizeof(l), "print('@' .. tostring(%s))", expr);
  nlogs = 0; bk_host_eval(l);
  const char *s = find_log("@"); snprintf(out, sizeof(out), "%s", s ? s + 1 : ""); return out;
}
static const char *sh_cond_expr;
static int sh_cond(void) { return sh_val(sh_cond_expr) != 0; }
static int sh_until(const char *expr, double secs) { sh_cond_expr = expr; return lk_until(sh_cond, lk_none, secs); }
static char *slurp(const char *path, size_t *n) {
  FILE *f = fopen(path, "rb"); if (!f) return NULL;
  fseek(f, 0, SEEK_END); long l = ftell(f); fseek(f, 0, SEEK_SET);
  char *b = malloc((size_t)l + 1); if (fread(b, 1, (size_t)l, f) != (size_t)l) { fclose(f); free(b); return NULL; }
  b[l] = 0; fclose(f); if (n) *n = (size_t)l; return b;
}

static int share_bit(int is_a, const char *flash, const char *data, const char *result) {
  setup(flash, data);
  /* a clean card: B has no shared files yet; A has its own Crossgate (a built-in, made into a file of its own) and a photo */
  { char p[1100]; const char *dirs[2] = { p_extra, p_caps };
    for (int k = 0; k < 2; k++) { DIR *d = opendir(dirs[k]); struct dirent *e;
      while (d && (e = readdir(d))) if (e->d_name[0] != '.') { snprintf(p, sizeof(p), "%s/%s", dirs[k], e->d_name); remove(p); }
      if (d) closedir(d); } }
  if (is_a) {
    char src[700], dst[700]; size_t n = 0;
    DIR *d = opendir(p_carts); struct dirent *e; src[0] = 0;
    while (d && (e = readdir(d))) if (strstr(e->d_name, "crossgate")) snprintf(src, sizeof(src), "%s/%s", p_carts, e->d_name);
    if (d) closedir(d);
    char *t = src[0] ? slurp(src, &n) : NULL;
    if (!t) { FAIL("Bit A: no Crossgate cart to share"); return 1; }
    char *b = strstr(t, "\"builtin\":true"); if (b) memcpy(b, "\"builtin\":   0", 14);   /* still valid JSON: a game of A's own */
    { char *q = strstr(t, "\"name\":\"Crossgate\""); if (q) memcpy(q, "\"name\":\"Crossgat2\"", 18); }
    snprintf(dst, sizeof(dst), "%s/my-crossgate.bitkit", p_extra);
    FILE *f = fopen(dst, "wb"); fwrite(t, 1, n, f); fclose(f); free(t);
    snprintf(dst, sizeof(dst), "%s/sunset-1.png", p_caps);
    f = fopen(dst, "wb"); for (int i = 0; i < 30000; i++) fputc((i * 7) & 0xFF, f); fclose(f);
  }
  cfg.radio_send = lk_send; cfg.millis = lk_ms;
  cfg.bit_id = is_a ? 0x0A0A0A01u : 0x0B0B0B02u;
  if (bk_host_init(&cfg)) { FAIL("host did not start"); return 1; }
  const char *me = is_a ? "Bit A" : "Bit B";
  const int games0 = bk_host_games();
  FILE *out = fopen(result, "w");
  if (!lk_until(lk_two, lk_none, 6)) FAIL("%s: never saw the other Bit", me);
  lk_until(lk_at_home, lk_none, 3);
  const int app = sh_find_app();
  if (!app) { FAIL("%s: no Share app", me); return 1; }
  bk_host_launch(app);
  if (!sh_in_app()) FAIL("%s: Share did not open", me);
  if (!sh_until("SHARE and #SHARE.bits == 1 and SHARE.bits[1].ready", 6)) FAIL("%s: the other Bit is not ready in Share", me);
  int got = 0;
  if (is_a) {
    const int ni = (int)sh_val("#SHARE.items");
    if (ni != 2) FAIL("Bit A: %d items to share, expected the game and the photo", ni);
    if (strcmp(sh_str("SHARE.items[1].name"), "Crossgat2") || strcmp(sh_str("SHARE.items[2].kind"), "photo")) FAIL("Bit A: items are %s, %s", sh_str("SHARE.items[1].name"), sh_str("SHARE.items[2].kind"));
    /* 1. the game */
    sh_req(1, 1, 1);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'ok'", 40)) FAIL("Bit A: the game was not sent (%s)", sh_str("SHARE.xfer and SHARE.xfer.state .. ' ' .. SHARE.xfer.done .. '/' .. SHARE.xfer.size .. ' ' .. SHARE.xfer.why"));
    sh_req(3, 0, 0);
    /* 2. the photo */
    sh_until("SHARE.bits[1].ready and not SHARE.xfer", 5);
    sh_req(1, 2, 1);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'ok'", 20)) FAIL("Bit A: the photo was not sent");
    sh_req(3, 0, 0);
    /* 3. B says no */
    sh_req(1, 1, 1);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'no'", 10)) FAIL("Bit A: no \"no thanks\" from Bit B");
    sh_req(3, 0, 0);
    /* 4. A stops it half way */
    sh_req(1, 1, 1);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'go' and SHARE.xfer.done > 4000", 15)) FAIL("Bit A: the last one did not start (%s)", sh_str("SHARE.xfer and SHARE.xfer.state .. ' ' .. SHARE.xfer.done .. ' ' .. SHARE.xfer.why"));
    sh_req(3, 0, 0);
    { const double t = now_us() + 1.5e6; while (now_us() < t) lk_tick(0); }
  } else {
    /* 1. the game: say yes */
    if (!sh_until("SHARE.offer", 10)) FAIL("Bit B: no offer");
    if (strcmp(sh_str("SHARE.offer.kind"), "game") || strcmp(sh_str("SHARE.offer.name"), "Crossgat2")) FAIL("Bit B: offer is %s %s", sh_str("SHARE.offer.kind"), sh_str("SHARE.offer.name"));
    sh_req(2, 1, 0);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'ok'", 40)) FAIL("Bit B: the game did not arrive (%s)", sh_str("SHARE.xfer and SHARE.xfer.state .. ' ' .. SHARE.xfer.done .. '/' .. SHARE.xfer.size .. ' ' .. SHARE.xfer.why"));
    if (bk_host_games() != games0 + 1 || !find_game("Crossgat2")) FAIL("Bit B: the game is not on the home screen (%d -> %d games)", games0, bk_host_games());
    else got++;
    sh_req(3, 0, 0);
    /* 2. the photo */
    if (!sh_until("SHARE.offer", 10)) FAIL("Bit B: no photo offer");
    sh_req(2, 1, 0);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'ok'", 20)) FAIL("Bit B: the photo did not arrive");
    else got++;
    sh_req(3, 0, 0);
    /* 3. no thanks */
    if (!sh_until("SHARE.offer", 10)) FAIL("Bit B: no third offer");
    sh_req(2, 0, 0);
    /* 4. say yes, then A stops it */
    if (!sh_until("SHARE.offer", 10)) FAIL("Bit B: no fourth offer (%s)", sh_str("SHARE.xfer and SHARE.xfer.state"));
    sh_req(2, 1, 0);
    if (!sh_until("SHARE.xfer and SHARE.xfer.state == 'fail'", 15)) FAIL("Bit B: did not notice Bit A stopping it (%s)", sh_str("SHARE.xfer and SHARE.xfer.state"));
    if (count_files(p_extra, ".bitkit") != 1) FAIL("Bit B: %d games on the card, expected 1 (a stopped one must leave nothing)", count_files(p_extra, ".bitkit"));
  }
  fprintf(out, "%d %d %d %d\n", got, bk_host_shared(), lk_sent, lk_lost);
  fclose(out);
  bk_host_go_home();
  bk_host_shutdown();
  return fails;
}

static int share_test(int argc, char **argv) {
  const char *flash = argv[2], *data = argv[3];
  for (int i = 4; i < argc; i++) {
    if (!strcmp(argv[i], "--loss") && i + 1 < argc) lk_loss = atoi(argv[++i]);
    else if (!strcmp(argv[i], "-v")) verbose = 1;
  }
  char da[600], db[600], ra[700], rb[700];
  mkdir(data, 0755);
  snprintf(da, sizeof(da), "%s/bit-a", data); snprintf(db, sizeof(db), "%s/bit-b", data);
  snprintf(ra, sizeof(ra), "%s/share-a.txt", data); snprintf(rb, sizeof(rb), "%s/share-b.txt", data);
  remove(ra); remove(rb);
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_DGRAM, 0, sv)) { perror("socketpair"); return 1; }
  fflush(NULL);
  const pid_t pid = fork();
  if (pid == 0) { close(sv[0]); lk_fd = sv[1]; lk_rs = 0x9E3779B97F4A7C15ull ^ (uint64_t)time(NULL) * 2654435761u; _exit(share_bit(0, flash, db, rb) ? 1 : 0); }
  close(sv[1]); lk_fd = sv[0]; lk_rs = 0xD1B54A32D192ED03ull ^ (uint64_t)time(NULL);
  const int fa = share_bit(1, flash, da, ra);
  int st = 0; waitpid(pid, &st, 0);
  const int fb = !WIFEXITED(st) || WEXITSTATUS(st);
  /* the game B got is byte for byte what A sent */
  char pa[800], pb[800]; size_t na = 0, nb = 0;
  snprintf(pa, sizeof(pa), "%s/games/my-crossgate.bitkit", da); snprintf(pb, sizeof(pb), "%s/games/crossgat2.bitkit", db);
  char *a = slurp(pa, &na), *b = slurp(pb, &nb);
  if (!a || !b || na != nb || memcmp(a, b, na)) FAIL("the game on Bit B is not the same as on Bit A (%zu / %zu bytes)", na, nb);
  else printf("game: %zu bytes arrived intact\n", nb);
  free(a); free(b);
  snprintf(pa, sizeof(pa), "%s/captures/sunset-1.png", da); snprintf(pb, sizeof(pb), "%s/captures/sunset-1.png", db);
  a = slurp(pa, &na); b = slurp(pb, &nb);
  if (!a || !b || na != nb || memcmp(a, b, na)) FAIL("the photo on Bit B is not the same as on Bit A");
  else printf("photo: %zu bytes arrived intact\n", nb);
  free(a); free(b);
  int ga = 0, sa = 0, xa = 0, la = 0, gb = 0, sb = 0, xb = 0, lb = 0;
  FILE *f = fopen(ra, "r"); if (!f || fscanf(f, "%d %d %d %d", &ga, &sa, &xa, &la) != 4) FAIL("no result from Bit A"); if (f) fclose(f);
  f = fopen(rb, "r"); if (!f || fscanf(f, "%d %d %d %d", &gb, &sb, &xb, &lb) != 4) FAIL("no result from Bit B"); if (f) fclose(f);
  printf("packets sent %d + %d, lost on purpose %d + %d (%d%%); transfers done: Bit A %d, Bit B %d\n", xa, xb, la, lb, lk_loss, sa, sb);
  if (sa != 2 || sb != 2) FAIL("expected 2 finished transfers on each Bit");
  if (fa || fb || fails) { fprintf(stderr, "share test failed\n"); return 1; }
  printf("ok: two Bits shared a game and a photo with the Share app, and handled a no and a stop\n");
  return 0;
}
