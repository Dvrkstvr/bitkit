/* Small in-place JSON reader (see bk_json.h). MIT License. */
#include "bk_json.h"
#include <stdlib.h>
#include <string.h>

typedef struct { char *p, *end; void *(*alloc)(size_t); int depth; } P;

static void ws(P *s) { while (s->p < s->end && (*s->p == ' ' || *s->p == '\n' || *s->p == '\r' || *s->p == '\t')) s->p++; }

static bk_json *node(P *s, int type) {
  bk_json *j = s->alloc(sizeof(bk_json));
  if (j) { memset(j, 0, sizeof(*j)); j->type = type; }
  return j;
}

static int hex4(const char *h, unsigned *out) {
  unsigned v = 0;
  for (int i = 0; i < 4; i++) {
    char c = h[i]; v <<= 4;
    if (c >= '0' && c <= '9') v |= (unsigned)(c - '0');
    else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10);
    else return 0;
  }
  *out = v;
  return 1;
}

static char *utf8(char *o, unsigned cp) {
  if (cp < 0x80) *o++ = (char)cp;
  else if (cp < 0x800) { *o++ = (char)(0xC0 | (cp >> 6)); *o++ = (char)(0x80 | (cp & 63)); }
  else if (cp < 0x10000) { *o++ = (char)(0xE0 | (cp >> 12)); *o++ = (char)(0x80 | ((cp >> 6) & 63)); *o++ = (char)(0x80 | (cp & 63)); }
  else { *o++ = (char)(0xF0 | (cp >> 18)); *o++ = (char)(0x80 | ((cp >> 12) & 63)); *o++ = (char)(0x80 | ((cp >> 6) & 63)); *o++ = (char)(0x80 | (cp & 63)); }
  return o;
}

/* decodes the string at s->p (just after the opening quote) in place; returns its start or NULL */
static char *string(P *s, size_t *len) {
  char *start = s->p, *o = s->p;
  while (s->p < s->end) {
    char c = *s->p++;
    if (c == '"') { *o = 0; if (len) *len = (size_t)(o - start); return start; }
    if (c != '\\') { *o++ = c; continue; }
    if (s->p >= s->end) return NULL;
    c = *s->p++;
    switch (c) {
      case 'n': *o++ = '\n'; break;
      case 't': *o++ = '\t'; break;
      case 'r': *o++ = '\r'; break;
      case 'b': *o++ = '\b'; break;
      case 'f': *o++ = '\f'; break;
      case 'u': {
        unsigned cp;
        if (s->end - s->p < 4 || !hex4(s->p, &cp)) return NULL;
        s->p += 4;
        if (cp >= 0xD800 && cp < 0xDC00 && s->end - s->p >= 6 && s->p[0] == '\\' && s->p[1] == 'u') {
          unsigned lo;
          if (hex4(s->p + 2, &lo) && lo >= 0xDC00 && lo < 0xE000) { cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); s->p += 6; }
        }
        o = utf8(o, cp);
        break;
      }
      default: *o++ = c; break;   /* \" \\ \/ */
    }
  }
  return NULL;
}

static bk_json *value(P *s);

static bk_json *list(P *s, int type) {
  bk_json *j = node(s, type), **tail;
  if (!j) return NULL;
  tail = &j->child;
  if (++s->depth > 64) return NULL;
  ws(s);
  char close = type == BJ_ARR ? ']' : '}';
  if (s->p < s->end && *s->p == close) { s->p++; s->depth--; return j; }
  for (;;) {
    const char *key = NULL;
    if (type == BJ_OBJ) {
      ws(s);
      if (s->p >= s->end || *s->p != '"') return NULL;
      s->p++;
      key = string(s, NULL);
      if (!key) return NULL;
      ws(s);
      if (s->p >= s->end || *s->p != ':') return NULL;
      s->p++;
    }
    bk_json *v = value(s);
    if (!v) return NULL;
    v->key = key;
    *tail = v; tail = &v->next;
    ws(s);
    if (s->p >= s->end) return NULL;
    if (*s->p == ',') { s->p++; continue; }
    if (*s->p == close) { s->p++; s->depth--; return j; }
    return NULL;
  }
}

static bk_json *value(P *s) {
  ws(s);
  if (s->p >= s->end) return NULL;
  char c = *s->p;
  if (c == '{') { s->p++; return list(s, BJ_OBJ); }
  if (c == '[') { s->p++; return list(s, BJ_ARR); }
  if (c == '"') {
    s->p++;
    bk_json *j = node(s, BJ_STR);
    if (!j || !(j->str = string(s, &j->len))) return NULL;
    return j;
  }
  if (!strncmp(s->p, "true", 4)) { s->p += 4; return node(s, BJ_TRUE); }
  if (!strncmp(s->p, "false", 5)) { s->p += 5; return node(s, BJ_FALSE); }
  if (!strncmp(s->p, "null", 4)) { s->p += 4; return node(s, BJ_NULL); }
  if (c == '-' || (c >= '0' && c <= '9')) {
    char *e;
    double d = strtod(s->p, &e);
    if (e == s->p) return NULL;
    s->p = e;
    bk_json *j = node(s, BJ_NUM);
    if (j) j->num = d;
    return j;
  }
  return NULL;
}

/* nodes come from alloc one by one; on an error the partial tree is not reachable, so parse into a list we can free */
typedef struct blk { struct blk *next; } blk;
static blk *g_blocks;
static void *(*g_alloc)(size_t);
static void *track_alloc(size_t n) {
  blk *b = g_alloc(sizeof(blk) + n);
  if (!b) return NULL;
  b->next = g_blocks; g_blocks = b;
  return b + 1;
}

bk_json *bk_json_parse(char *text, size_t len, void *(*alloc)(size_t)) {
  g_alloc = alloc ? alloc : malloc;
  g_blocks = NULL;
  P s = { text, text + len, track_alloc, 0 };
  bk_json *j = value(&s);
  if (j) ws(&s);
  if (!j || s.p != s.end) {
    for (blk *b = g_blocks, *n; b; b = n) { n = b->next; free(b); }
    g_blocks = NULL;
    return NULL;
  }
  /* keep the block list in the root's spare pointer: the root never has a key */
  j->key = (const char *)g_blocks;
  g_blocks = NULL;
  return j;
}

void bk_json_free(bk_json *j, void (*release)(void *)) {
  if (!j) return;
  if (!release) release = free;
  for (blk *b = (blk *)(void *)j->key, *n; b; b = n) { n = b->next; release(b); }
}

const bk_json *bk_json_get(const bk_json *obj, const char *key) {
  if (!obj || obj->type != BJ_OBJ) return NULL;
  for (const bk_json *c = obj->child; c; c = c->next) if (c->key && !strcmp(c->key, key)) return c;
  return NULL;
}
const char *bk_json_str(const bk_json *obj, const char *key, const char *fallback) {
  const bk_json *v = bk_json_get(obj, key);
  return v && v->type == BJ_STR ? v->str : fallback;
}
double bk_json_num(const bk_json *obj, const char *key, double fallback) {
  const bk_json *v = bk_json_get(obj, key);
  return v && v->type == BJ_NUM ? v->num : fallback;
}
int bk_json_bool(const bk_json *obj, const char *key, int fallback) {
  const bk_json *v = bk_json_get(obj, key);
  return v ? v->type == BJ_TRUE : fallback;
}
