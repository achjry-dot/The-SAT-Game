/* =========================================================================
   ui/menu.js - the menu tree and the cursor that walks it.

   Deliberately split from screens.js: this file knows the SHAPE of the menu
   and nothing about how it is drawn, and screens.js draws whatever this hands
   it without knowing what the entries mean. The old menu was three hard-coded
   entries and a switch statement, which was fine for three entries; the moment
   it became a tree, "which item is selected" stopped being an integer and
   started being a path, and that is worth keeping in one place where it can be
   reasoned about on its own.

   A leaf carries exactly one of:
     mode    - start an exam with these parameters
     action  - open another screen, or leave

   Timings and question counts in the notes are the College Board's published
   figures for the digital SAT: Reading and Writing is two 32-minute modules of
   27 questions, Math is two 35-minute modules of 22, and a full form is those
   four modules back to back - 134 minutes of testing, scored 400-1600.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Section keys used throughout the game: 'rw', 'math', or 'both'. */
const SECTION = { RW: 'rw', MATH: 'math', BOTH: 'both' };

/* Mode kinds:
     infinity  the original game - one wrong answer ends the run
     module    a single section played as real modules, scored to 800
     full      both sections, four modules, scored to 1600            */
const KIND = { INFINITY: 'infinity', MODULE: 'module', FULL: 'full' };

const MENU_TREE = {
  key: 'root',
  items: [
    { key: 'play', label: 'PLAY', items: [
      { key: 'english', label: 'ENGLISH', note: 'READING AND WRITING QUESTIONS ONLY', items: [
        { key: 'rw-module', label: 'MODULE',
          note: '2 MODULES   32 MIN EACH   54 QUESTIONS   SCORED TO 800',
          mode: { kind: KIND.MODULE, section: SECTION.RW } },
        { key: 'rw-infinity', label: 'INFINITY',
          note: 'ENDLESS   ONE WRONG ANSWER ENDS THE RUN',
          mode: { kind: KIND.INFINITY, section: SECTION.RW } }
      ] },
      { key: 'math', label: 'MATH', note: 'MATH QUESTIONS ONLY', items: [
        { key: 'math-module', label: 'MODULE',
          note: '2 MODULES   35 MIN EACH   44 QUESTIONS   SCORED TO 800',
          mode: { kind: KIND.MODULE, section: SECTION.MATH } },
        { key: 'math-infinity', label: 'INFINITY',
          note: 'ENDLESS   ONE WRONG ANSWER ENDS THE RUN',
          mode: { kind: KIND.INFINITY, section: SECTION.MATH } }
      ] },
      { key: 'default', label: 'DEFAULT', note: 'BOTH SECTIONS TOGETHER', items: [
        { key: 'full-sat', label: 'THE FULL SAT',
          note: '4 MODULES   2H 14M   98 QUESTIONS   SCORED TO 1600',
          mode: { kind: KIND.FULL, section: SECTION.BOTH } },
        { key: 'both-infinity', label: 'INFINITY',
          note: 'ENDLESS   ONE WRONG ANSWER ENDS THE RUN',
          mode: { kind: KIND.INFINITY, section: SECTION.BOTH } }
      ] }
    ] },
    { key: 'feedback', label: 'FEEDBACK', note: 'SEND A REPORT TO THE DEVELOPER',
      action: 'feedback' },
    { key: 'stats',    label: 'STATS',    note: 'YOUR RESULTS, STRENGTHS AND WEAKNESSES',
      action: 'stats' },
    { key: 'settings', label: 'SETTINGS', note: 'BRIGHTNESS, SOUND AND DISPLAY',
      action: 'settings' },
    { key: 'exit',     label: 'EXIT',     note: 'END THE SESSION', action: 'exit' }
  ]
};

/* The synthetic entry appended to every submenu. It is a real item rather
   than a keyboard-only gesture because the game is played with the mouse: ESC
   is the fast way up, but a player who has only ever clicked needs something
   to click, and a submenu with no visible way out is a dead end. */
const BACK_KEY = '__back';

class MenuNav {
  constructor(tree) {
    this.tree = tree || MENU_TREE;
    /* `path` is the chain of indices taken from the root.

       `cursors` remembers the highlighted entry of every menu the player has
       visited, keyed by that menu's path rather than by its depth. Depth is
       the obvious key and it is wrong twice over: backing out has to discard
       the level it left (or the key collides with wherever you go next), which
       throws away the memory this exists to provide; and every branch at the
       same depth shares one slot, so highlighting INFINITY under ENGLISH would
       silently pre-select INFINITY under MATH. Keying by path costs a string
       join and both problems go away. */
    this.path = [];
    this.cursors = Object.create(null);
  }

  reset() {
    this.path.length = 0;
    this.cursors = Object.create(null);
  }

  /* Identity of the menu currently on screen: '' at the root, '0/1' for the
     second child of the first child, and so on. */
  pathKey() { return this.path.join('/'); }

  /* The node whose children are currently on screen. */
  get node() {
    let n = this.tree;
    for (const i of this.path) n = n.items[i];
    return n;
  }

  get depth() { return this.path.length; }

  /* What the screen draws: the real children, plus BACK below the top level. */
  get items() {
    const list = this.node.items.slice();
    if (this.depth > 0) list.push({ key: BACK_KEY, label: 'BACK', note: 'RETURN' });
    return list;
  }

  get index() {
    const i = this.cursors[this.pathKey()] || 0;
    return Math.max(0, Math.min(i, this.items.length - 1));
  }

  set index(i) { this.cursors[this.pathKey()] = i; }

  get selected() { return this.items[this.index]; }

  /* "PLAY / ENGLISH" - empty at the top level, where the game's own title is
     already doing that job. */
  get breadcrumb() {
    const parts = [];
    let n = this.tree;
    for (const i of this.path) { n = n.items[i]; parts.push(n.label); }
    return parts.join(' / ');
  }

  move(dir) {
    const n = this.items.length;
    if (n === 0) return false;
    const next = (this.index + dir + n) % n;
    if (next === this.index) return false;
    this.index = next;
    return true;
  }

  setIndex(i) {
    if (i < 0 || i >= this.items.length || i === this.index) return false;
    this.index = i;
    return true;
  }

  /* Activate the highlighted entry. Returns a description of what should
     happen rather than doing it, so the tree stays free of game state. */
  enter() {
    const item = this.selected;
    if (!item) return { type: 'none' };
    if (item.key === BACK_KEY) return this.back() ? { type: 'back' } : { type: 'none' };
    if (item.items && item.items.length) {
      // A first visit reads 0 from the cursor map; a return visit reads
      // whatever was left highlighted there.
      this.path.push(this.node.items.indexOf(item));
      return { type: 'submenu', item };
    }
    if (item.mode)   return { type: 'mode', mode: item.mode, item };
    if (item.action) return { type: 'action', action: item.action, item };
    return { type: 'none' };
  }

  back() {
    if (!this.path.length) return false;
    // The cursor of the level being left is deliberately KEPT, so coming back
    // in lands where the player was rather than at the top of the list.
    this.path.pop();
    return true;
  }
}

/* A human label for a mode, used by the results screen and the stats records
   so the same run is never described two different ways. */
function modeLabel(mode) {
  if (!mode) return '';
  const sec = mode.section === SECTION.RW ? 'ENGLISH'
            : mode.section === SECTION.MATH ? 'MATH' : 'FULL';
  if (mode.kind === KIND.FULL)   return 'THE FULL SAT';
  if (mode.kind === KIND.MODULE) return sec + ' MODULE';
  return sec === 'FULL' ? 'INFINITY' : sec + ' INFINITY';
}

SATG.menu = { MENU_TREE, MenuNav, SECTION, KIND, BACK_KEY, modeLabel };

})(window);
