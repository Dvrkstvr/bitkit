-- ================================================================ languages
-- The Bit's language is picked in the Settings app (LANGUAGE) and is the same for every game. A game reads it with
-- lang() ("en", "de", "fr", "es") and lists its own words for other languages with texts{}:
--
--   texts{
--     de = { ["Start"] = "Los", ["SCORE #"] = "PUNKTE #", ["You found %s!"] = "Du hast %s gefunden!" },
--     fr = { ["Start"] = "Partez" },
--   }
--
-- After that, text("Start", ...) draws "Los" on a German Bit by itself: the words are looked up as written, then
-- with their numbers swapped for # ("SCORE 120" finds "SCORE #" and draws "PUNKTE 120"). A word that gets longer
-- keeps its place when it was centred on the screen or sat at its right edge; anything else starts where it did.
-- For words put together in code, or wrapped into lines, translate first:
--   tr("Start")                -> "Los" (or "Start" when there's no word for it)
--   tr("You found %s!", item)  -> translated, then string.format'ed
--   tr{en = "Start", de = "Los"} -> one of these, English when the Bit's language isn't there
--   textw(s)                   -> how wide text(s) is in pixels (use it to centre: 160 - textw(s) // 2)
--   texts(false)               -> text() stops translating on its own (tr() still works)
-- tr() hands back the Bit's one-byte text (Windows-1252: ä is one letter), so #s counts letters for layouts.
-- Cart source can use UTF-8 freely: "Größe", "¿Listo?", "Ça va" all draw with the 8x8 font.

LANGUAGES = {
  { "en", "English" },
  { "de", "Deutsch" },
  { "fr", "Français" },
  { "es", "Español" },
}
_TEXTS = {}
function texts(t)
  if t == false or t == true then _texts_auto(t) return end
  if type(t) == "table" then _TEXTS[#_TEXTS + 1] = t end
end
function lang_name(code)
  code = code or lang()
  for _, l in ipairs(LANGUAGES) do if l[1] == code then return l[2] end end
  return code
end

-- the Bit's own words: the game shell (title, pause, settings, how to play, races) and common setting values
_SYSTEXT = {
  de = {
    ["Continue"] = "Weiterspielen", ["New game"] = "Neues Spiel", ["Settings"] = "Einstellungen",
    ["How to play"] = "Spielanleitung", ["Resume"] = "Weiter", ["Leave race"] = "Rennen verlassen",
    ["Quit to title"] = "Zurück zum Titel", ["Keep playing"] = "Weiterspielen", ["Back to title"] = "Zurück zum Titel",
    ["Volume"] = "Lautstärke", ["Music"] = "Musik", ["Delete save"] = "Spielstand löschen", ["Back"] = "Zurück",
    ["Cancel"] = "Abbrechen",
    ["hold A: choose"] = "A halten: wählen", ["Rematch"] = "Revanche", ["Play"] = "Spielen", ["Change mode"] = "Modus wechseln",
    ["Again"] = "Nochmal", ["Try again"] = "Nochmal versuchen", ["PICK A MODE"] = "MODUS WÄHLEN",
    ["Delete your save? Your progress in this game is gone for good."] =
      "Spielstand löschen? Dein Fortschritt in diesem Spiel ist dann für immer weg.",
    ["Goal:"] = "Ziel:", ["* goal done *"] = "* Ziel erreicht *", ["A: choose"] = "A: wählen",
    ["%s OF %d!"] = "%s VON %d!", ["FINISHED!"] = "IM ZIEL!", [" (YOU)"] = " (DU)", ["left"] = "weg",
    ["racing"] = "fährt", ["waiting for the others...   A: choose"] = "Warte auf die anderen...   A: wählen",
    ["GOAL COMPLETE!"] = "ZIEL ERREICHT!", ["PAUSED"] = "PAUSE", ["A: choose   B: back to the game"] = "A: wählen   B: zurück zum Spiel",
    ["SETTINGS"] = "EINSTELLUNGEN", ["left / right: change   B: back"] = "links / rechts: ändern   B: zurück",
    ["HOW TO PLAY"] = "SPIELANLEITUNG", ["B: back"] = "B: zurück", ["GO!"] = "LOS!",
    ["RACE ON # BITS"] = "RENNEN AUF # BITS", ["RACE #:#  #/# IN"] = "RENNEN #:#  #/# IM ZIEL",
    ["RACE #  #/# IN"] = "RENNEN #  #/# IM ZIEL", ["%s FINISHED  %s"] = "%s IM ZIEL  %s", ["BitKit game"] = "BitKit-Spiel",
    ["Easy"] = "Leicht", ["Normal"] = "Normal", ["Hard"] = "Schwer", ["On"] = "An", ["Off"] = "Aus", ["Yes"] = "Ja", ["No"] = "Nein",
    ["Players"] = "Spieler", ["Level"] = "Level", ["Levels"] = "Level", ["Score"] = "Punkte", ["Time"] = "Zeit", ["Lives"] = "Leben",
    ["Laps"] = "Runden", ["Rivals"] = "Gegner", ["Difficulty"] = "Schwierigkeit", ["Speed"] = "Tempo", ["Slow"] = "Langsam",
    ["Fast"] = "Schnell", ["Short"] = "Kurz", ["Long"] = "Lang", ["Small"] = "Klein", ["Big"] = "Groß", ["Medium"] = "Mittel",
    ["Rounds"] = "Runden", ["Sound"] = "Ton", ["Sound effects"] = "Soundeffekte", ["Controls"] = "Steuerung",
    ["Back to checkpoint"] = "Zum Kontrollpunkt", ["Restart level"] = "Level neu starten", ["Skip"] = "Überspringen", ["START skip"] = "START überspringen",
  },
  fr = {
    ["Continue"] = "Continuer", ["New game"] = "Nouvelle partie", ["Settings"] = "Paramètres",
    ["How to play"] = "Comment jouer", ["Resume"] = "Reprendre", ["Leave race"] = "Quitter la course",
    ["Quit to title"] = "Retour au titre", ["Keep playing"] = "Continuer", ["Back to title"] = "Retour au titre",
    ["Volume"] = "Volume", ["Music"] = "Musique", ["Delete save"] = "Effacer sauvegarde", ["Back"] = "Retour",
    ["Cancel"] = "Annuler",
    ["Delete your save? Your progress in this game is gone for good."] =
      "Effacer la sauvegarde ? Ta progression dans ce jeu sera perdue pour de bon.",
    ["Goal:"] = "But :", ["* goal done *"] = "* but atteint *", ["A: choose"] = "A : choisir",
    ["%s OF %d!"] = "%s SUR %d !", ["FINISHED!"] = "ARRIVÉ !", [" (YOU)"] = " (TOI)", ["left"] = "parti",
    ["racing"] = "en course", ["waiting for the others...   A: choose"] = "on attend les autres...   A : choisir",
    ["GOAL COMPLETE!"] = "BUT ATTEINT !", ["PAUSED"] = "PAUSE", ["A: choose   B: back to the game"] = "A : choisir   B : retour au jeu",
    ["SETTINGS"] = "PARAMÈTRES", ["left / right: change   B: back"] = "gauche / droite : changer   B : retour",
    ["HOW TO PLAY"] = "COMMENT JOUER", ["B: back"] = "B : retour", ["GO!"] = "PARTEZ !",
    ["RACE ON # BITS"] = "COURSE SUR # BITS", ["RACE #:#  #/# IN"] = "COURSE #:#  #/# ARRIVÉS",
    ["RACE #  #/# IN"] = "COURSE #  #/# ARRIVÉS", ["%s FINISHED  %s"] = "%s ARRIVÉ  %s", ["BitKit game"] = "Jeu BitKit",
    ["Easy"] = "Facile", ["Normal"] = "Normal", ["Hard"] = "Difficile", ["On"] = "Oui", ["Off"] = "Non", ["Yes"] = "Oui", ["No"] = "Non",
    ["Players"] = "Joueurs", ["Level"] = "Niveau", ["Levels"] = "Niveaux", ["Score"] = "Score", ["Time"] = "Temps", ["Lives"] = "Vies",
    ["Laps"] = "Tours", ["Rivals"] = "Rivaux", ["Difficulty"] = "Difficulté", ["Speed"] = "Vitesse", ["Slow"] = "Lent",
    ["Fast"] = "Rapide", ["Short"] = "Court", ["Long"] = "Long", ["Small"] = "Petit", ["Big"] = "Grand", ["Medium"] = "Moyen",
    ["Rounds"] = "Manches", ["Sound"] = "Son", ["Sound effects"] = "Effets sonores", ["Controls"] = "Commandes",
    ["Back to checkpoint"] = "Au point de contrôle", ["Restart level"] = "Recommencer", ["Skip"] = "Passer", ["START skip"] = "START passer",
  },
  es = {
    ["Continue"] = "Continuar", ["New game"] = "Nueva partida", ["Settings"] = "Ajustes",
    ["How to play"] = "Cómo jugar", ["Resume"] = "Seguir", ["Leave race"] = "Dejar la carrera",
    ["Quit to title"] = "Volver al título", ["Keep playing"] = "Seguir jugando", ["Back to title"] = "Volver al título",
    ["Volume"] = "Volumen", ["Music"] = "Música", ["Delete save"] = "Borrar partida", ["Back"] = "Atrás",
    ["Cancel"] = "Cancelar",
    ["Delete your save? Your progress in this game is gone for good."] =
      "¿Borrar la partida? Tu progreso en este juego se perderá para siempre.",
    ["Goal:"] = "Meta:", ["* goal done *"] = "* meta cumplida *", ["A: choose"] = "A: elegir",
    ["%s OF %d!"] = "¡%s DE %d!", ["FINISHED!"] = "¡LLEGASTE!", [" (YOU)"] = " (TÚ)", ["left"] = "se fue",
    ["racing"] = "en carrera", ["waiting for the others...   A: choose"] = "esperando a los demás...   A: elegir",
    ["GOAL COMPLETE!"] = "¡META CUMPLIDA!", ["PAUSED"] = "PAUSA", ["A: choose   B: back to the game"] = "A: elegir   B: volver al juego",
    ["SETTINGS"] = "AJUSTES", ["left / right: change   B: back"] = "izq. / der.: cambiar   B: atrás",
    ["HOW TO PLAY"] = "CÓMO JUGAR", ["B: back"] = "B: atrás", ["GO!"] = "¡YA!",
    ["RACE ON # BITS"] = "CARRERA EN # BITS", ["RACE #:#  #/# IN"] = "CARRERA #:#  #/# LLEGAN",
    ["RACE #  #/# IN"] = "CARRERA #  #/# LLEGAN", ["%s FINISHED  %s"] = "%s LLEGÓ  %s", ["BitKit game"] = "Juego BitKit",
    ["Easy"] = "Fácil", ["Normal"] = "Normal", ["Hard"] = "Difícil", ["On"] = "Sí", ["Off"] = "No", ["Yes"] = "Sí", ["No"] = "No",
    ["Players"] = "Jugadores", ["Level"] = "Nivel", ["Levels"] = "Niveles", ["Score"] = "Puntos", ["Time"] = "Tiempo", ["Lives"] = "Vidas",
    ["Laps"] = "Vueltas", ["Rivals"] = "Rivales", ["Difficulty"] = "Dificultad", ["Speed"] = "Velocidad", ["Slow"] = "Lento",
    ["Fast"] = "Rápido", ["Short"] = "Corto", ["Long"] = "Largo", ["Small"] = "Pequeño", ["Big"] = "Grande", ["Medium"] = "Medio",
    ["Rounds"] = "Rondas", ["Sound"] = "Sonido", ["Sound effects"] = "Efectos", ["Controls"] = "Controles",
    ["Back to checkpoint"] = "Al punto de control", ["Restart level"] = "Reiniciar nivel", ["Skip"] = "Saltar", ["START skip"] = "START saltar",
  },
}

-- ordinal places for race standings: 1st / 1. / 1er / 1º
function lang_nth(n)
  local l = lang()
  if l == "de" then return n .. "." end
  if l == "fr" then return n .. (n == 1 and "ER" or "E") end
  if l == "es" then return n .. "º" end
  local k = n % 100
  return n .. ((k >= 11 and k <= 13) and "TH" or ({ "ST", "ND", "RD" })[n % 10] or "TH")
end
