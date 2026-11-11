# Contributing to BitKit

Thanks for wanting to help! BitKit is a small, friendly project, and every bug report, idea, cart and pull request is welcome.

## Ways to help

- **Make a game** with the [studio](https://dvrkstvr.github.io/bitkit/) and share it in an issue. Games follow the [game rules](GAME_RULES.md): a main menu, one level you can finish, quick resume, a pause menu with settings and a clear goal. `game{}` does most of it, and the studio's **Rules** button checks it.
- **Report a bug.** Include your browser, controller and, if you can, the `.bitkit` cart.
- **Suggest a feature** with the idea template.
- **Send a pull request.** Small and focused is best.

## Working on the code

```sh
cd studio && python3 -m http.server 8000   # studio dev server, no build step
./build.sh                                 # rebuild studio/runtime.js after changing C or runtime/*.lua (needs Emscripten)
node tools/ci.cjs                          # the same check CI runs
node tools/gametest.cjs                    # the game shell and the game rules in every demo
python3 tools/bundle.py dist/bitkit-studio.html   # refresh the offline single-file build
```

- `runtime/` is portable C and Lua. It must also run on the ESP32-S3, so avoid big allocations and platform APIs.
- `studio/` is plain HTML, CSS and JavaScript with no framework and no bundler.
- If you change the runtime, commit the rebuilt `studio/runtime.js` and `dist/bitkit-studio.html`.

## Licence and code origin

BitKit is MIT. Only contribute code you wrote or that comes under an MIT-compatible licence. Do not copy code from GPL projects; ideas are fine, code is not.
