'use strict';
// Light or dark. The browser keeps two choices: `room-theme` (auto, light or dark; auto follows the system) and
// `room-dark-style` (navy, black or warm). Loaded in the page's head before the stylesheet, so the page is drawn in
// the right colours from the start (the page's security policy allows no script written into the page itself);
// room.css does the rest from the two attributes set here. tests/room_suite.py runs this same file in node's vm.
globalThis.RoomTheme = (() => {
  const THEMES = ['auto', 'light', 'dark'];
  const STYLES = ['navy', 'black', 'warm'];
  // What the page shows for a stored choice and a system that is dark or not. Anything unknown counts as auto / navy.
  const resolve = (theme, style, systemDark) => {
    const t = THEMES.includes(theme) ? theme : 'auto';
    return { theme: t, style: STYLES.includes(style) ? style : 'navy', dark: t === 'dark' || (t === 'auto' && Boolean(systemDark)) };
  };
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const system = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
  const show = (now) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = now.dark ? 'dark' : 'light';
      document.documentElement.dataset.dark = now.style;
    }
    return now;
  };
  const current = () => resolve(read('room-theme'), read('room-dark-style'), system() && system().matches);
  // `key` is 'room-theme' or 'room-dark-style'. A private window can't remember it; the page still changes.
  function choose(key, value) {
    try { localStorage.setItem(key, value); } catch { /* not remembered */ }
    return show(resolve(key === 'room-theme' ? value : read('room-theme'), key === 'room-dark-style' ? value : read('room-dark-style'), system() && system().matches));
  }
  show(current());
  if (system() && system().addEventListener) system().addEventListener('change', () => show(current()));
  return { THEMES, STYLES, resolve, current, choose };
})();
