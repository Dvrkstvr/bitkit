/* A small JSON reader for cart files on the device. Parses in place: strings are decoded inside the text buffer,
   so the buffer must stay alive (and writable) while the tree is used. MIT License. */
#pragma once
#include <stddef.h>

enum { BJ_NULL, BJ_FALSE, BJ_TRUE, BJ_NUM, BJ_STR, BJ_ARR, BJ_OBJ };

typedef struct bk_json {
  int type;
  const char *key;          /* member name inside an object, else NULL */
  const char *str;          /* BJ_STR: the decoded string (0-terminated) */
  size_t len;               /* BJ_STR: its length in bytes */
  double num;               /* BJ_NUM */
  struct bk_json *child;    /* first element / member */
  struct bk_json *next;     /* next sibling */
} bk_json;

/* alloc may be NULL (malloc). Returns NULL on a syntax error or when out of memory. */
bk_json *bk_json_parse(char *text, size_t len, void *(*alloc)(size_t));
void bk_json_free(bk_json *j, void (*release)(void *));   /* release may be NULL (free) */
const bk_json *bk_json_get(const bk_json *obj, const char *key);
const char *bk_json_str(const bk_json *obj, const char *key, const char *fallback);
double bk_json_num(const bk_json *obj, const char *key, double fallback);
int bk_json_bool(const bk_json *obj, const char *key, int fallback);
