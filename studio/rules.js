/* BitKit game rules (GAME_RULES.md): a quick check of a cart's code against them.
   Used by the studio's Rules button and by tools/gametest.cjs. MIT License. */
(function () {
  // strip Lua comments so a commented-out game{} doesn't count
  const code = s => String(s || '').replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');
  const field = (src, name) => {
    const m = new RegExp('\\b' + name + '\\s*=\\s*(["\'])((?:\\\\.|(?!\\1).)*)\\1').exec(src);
    return m ? m[2] : null;
  };
  const RULES = [
    { id: 'menu', name: 'Main menu',
      about: 'A title screen with New game (Continue once there is a save file) and Settings. Call game{title = "...", ...} in _init.',
      test: src => /\bgame\s*[{(]/.test(src) && !!field(src, 'title') },
    { id: 'goal', name: 'A clear goal',
      about: 'One sentence the player reads on the title screen: game{goal = "Reach the flag."}.',
      test: src => (field(src, 'goal') || '').trim().length >= 8 || /\bgoal\s*=\s*["'(]?[^,\n}]*\.\./.test(src) },
    { id: 'end', name: 'One level, start to end',
      about: 'There is a way to finish: call game_win("...") when the goal is reached.',
      test: src => /\bgame_win\s*\(/.test(src) },
    { id: 'resume', name: 'Quick resume',
      about: 'Continue goes straight back into play: save a checkpoint({...}) and pass continue = function(cp) ... end (or can_continue for games that keep their own save).',
      test: src => /\bcheckpoint\s*\(/.test(src) || /\bcan_continue\s*=/.test(src) || /\bcontinue\s*=\s*function/.test(src) },
    { id: 'pause', name: 'Pause menu with settings',
      about: 'Start pauses the game with Resume, Settings (volume) and Quit to title. game{} adds it; don\'t use Start for anything else.',
      test: src => /\bgame\s*[{(]/.test(src) && !/\bbtn[pr]?\s*\(\s*["']start["']/.test(src) },
  ];
  function check(c) {
    const src = code(c && c.code);
    return RULES.map(r => ({ id: r.id, name: r.name, about: r.about, ok: !!r.test(src) }));
  }
  window.BKRules = { RULES, check, players };

  // How many can play a cart, from game{players = ..., race = ...} (GAME_RULES.md, "Players"):
  // { min, max, race: 'time' | 'score' | null, declared }. Without players = ..., a game that never mentions
  // PLAYERS is a one-player game, and one that does is 1-8. The device reads it the same way
  // (platform/device/bk_cart.c bk_cart_players): keep the two in step.
  function players(src) {
    src = String(src || '');
    const out = { min: 1, max: 1, race: null, declared: false };
    const n = src.length;
    // skip a comment or a string at i; returns where it ends, or -1 when there is none at i
    const skip = i => {
      const c = src[i];
      if (c === '-' && src[i + 1] === '-') {
        if (src[i + 2] === '[' && src[i + 3] === '[') { const e = src.indexOf(']]', i + 4); return e < 0 ? n : e + 2; }
        while (i < n && src[i] !== '\n') i++;
        return i;
      }
      if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; return i + 1; }
      if (c === '[' && src[i + 1] === '[') { const e = src.indexOf(']]', i + 2); return e < 0 ? n : e + 2; }
      return -1;
    };
    const word = c => /[\w]/.test(c || '');
    let body = '', seesPlayers = false, last = '', lastId = '';   // the last thing outside comments: a character, or an identifier
    for (let i = 0; i < n;) {
      const e = skip(i);
      if (e >= 0) { if (src[i] !== '-') { last = '"'; lastId = ''; } i = e; continue; }
      if (word(src[i])) {
        let j = i;
        while (j < n && word(src[j])) j++;
        const id = src.slice(i, j);
        if (id === 'PLAYERS') seesPlayers = true;
        if (id === 'game' && !body && last !== '.' && last !== ':' && lastId !== 'function') {
          let q = j;
          while (q < n && /\s/.test(src[q])) q++;
          if (src[q] === '(') { q++; while (q < n && /\s/.test(src[q])) q++; }
          if (src[q] === '{') {   // the table given to game{}: up to its closing brace (strings and comments skipped)
            let d = 1, r = q + 1;
            while (r < n && d > 0) {
              const e2 = skip(r);
              if (e2 >= 0) { r = e2; continue; }
              if (src[r] === '{') d++; else if (src[r] === '}') d--;
              r++;
            }
            body = src.slice(q + 1, r - 1);
          }
        }
        last = 'a'; lastId = id;
        i = j;
        continue;
      }
      if (!/\s/.test(src[i])) { last = src[i]; lastId = ''; }
      i++;
    }
    const p = /(^|[^\w."'])players\s*=\s*(?:\{\s*(\d+)\s*,\s*(\d+)\s*\}|(\d+))/.exec(body);
    if (p) {
      out.declared = true;
      if (p[4]) out.min = out.max = +p[4]; else { out.min = +p[2]; out.max = +p[3]; }
    } else if (seesPlayers) out.max = 8;
    out.max = Math.max(1, Math.min(out.max, 99));
    out.min = Math.max(1, Math.min(out.min, out.max));
    const r = /(^|[^\w."'])race\s*=\s*["'](time|score)["']/.exec(body);
    if (r) out.race = r[2];
    return out;
  }
  // "1 player", "2-4 players", "1-8 players"
  function playersLabel(p) {
    return p.max === 1 ? '1 player' : (p.min === p.max ? p.max : p.min + '-' + p.max) + ' players';
  }
  window.BKPlayers = { of: players, label: playersLabel };
})();
