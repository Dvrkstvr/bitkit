// Only used with Emscripten older than 3.1.35 (e.g. Ubuntu's emscripten package), which lacks stringToNewUTF8.
{
  Module['stringToNewUTF8'] = function (s) {
    var n = lengthBytesUTF8(s) + 1, p = _malloc(n);
    stringToUTF8(s, p, n);
    return p;
  };
}
