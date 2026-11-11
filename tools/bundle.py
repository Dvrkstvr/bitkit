#!/usr/bin/env python3
"""Inline the studio into one self-contained HTML file (works offline and from file://).
Usage: python3 tools/bundle.py [--fragment] OUT.html
--fragment drops the <!doctype>/<html>/<head>/<body> wrapper (for hosts that add their own)."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / 'studio'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
fragment = '--fragment' in sys.argv
html = (root / 'index.html').read_text()
def css(m): return '<style>\n' + (root / m.group(1)).read_text() + '\n</style>'
def js(m): return '<script>\n' + (root / m.group(1)).read_text().replace('</script', '<\\/script') + '\n</script>'
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
html = re.sub(r'<script src="([^"]+)"></script>', js, html)
if fragment:
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    head = re.sub(r'<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', '', head)
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    html = head.strip() + '\n' + body.strip() + '\n'
pathlib.Path(args[0]).write_text(html)
print(f'wrote {args[0]} ({len(html)//1024} KB)')
