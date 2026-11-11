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
  window.BKRules = { RULES, check };
})();
