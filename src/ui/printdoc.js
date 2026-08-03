/* =========================================================================
   ui/printdoc.js - the formal, printable version of the analysis.

   Why this is not drawn on the canvas like everything else:

     - a canvas cannot be printed. window.print() would emit a screenshot of
       whatever happened to be on screen, at screen resolution, with the page
       break falling wherever it liked.
     - a canvas cannot hold a hyperlink. Every study link would have to be
       typed out by hand from a printout.
     - a canvas cannot be selected, copied, searched, or read by a screen
       reader.

   So PRINT builds a real document in a DOM layer above the game. That is a
   deliberate break from the project's rule of rendering everything itself,
   and it is the right one: the alternative is a "print" button that produces
   something nobody can print.

   The layer is removed completely on close - not hidden - because a
   full-screen div left in the document would swallow every pointer event the
   game needs, and the failure would look like the game freezing.

   Layout follows a real progress report: a two-column spread per section with
   the chart beside the table rather than under it, an identity block repeated
   on every printed page, and a footer carrying the page number and the note
   about how the scale was derived.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const TX = SATG.taxonomy;

const ID = 'satg-printdoc';

let host = null;
let onClose = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}

function pct(e) { return e.total ? Math.round((e.right / e.total) * 100) : 0; }

/* A qualitative band, in the style a real score report uses.

   Deliberately withheld below the evidence threshold rather than defaulting to
   the bottom band: "Low" and "we have not seen enough of these to say" are
   different findings, and printing the first when the second is true is the
   report lying in the student's hand. */
function band(e) {
  if (!TX.enoughData(e.total)) return { label: '--', cls: 'b-none' };
  const p = e.total ? e.right / e.total : 0;
  if (p >= 0.9) return { label: 'High', cls: 'b-hi' };
  if (p >= 0.75) return { label: 'HiAvg', cls: 'b-hiavg' };
  if (p >= 0.5) return { label: 'Avg', cls: 'b-avg' };
  if (p >= 0.3) return { label: 'LoAvg', cls: 'b-loavg' };
  return { label: 'Low', cls: 'b-lo' };
}

/* An inline SVG bar. Small enough to build by hand, and it prints - a canvas
   in a print stylesheet frequently does not. */
function bar(e, w) {
  w = w || 150;
  const p = e.total ? e.right / e.total : 0;
  const fill = TX.enoughData(e.total)
    ? (p >= 0.7 ? '#1c7a4a' : p >= 0.45 ? '#8f6410' : '#a3342a')
    : '#b9bfc4';
  const filled = Math.round(w * Math.max(0, Math.min(1, p)));
  return '<svg class="bar" width="' + w + '" height="10" role="img" ' +
         'aria-label="' + pct(e) + ' percent">' +
         '<rect x="0" y="0" width="' + w + '" height="10" fill="#e6ebef"></rect>' +
         '<rect x="0" y="0" width="' + filled + '" height="10" fill="' + fill + '"></rect>' +
         '</svg>';
}

/* The answer sheet, as a grid of small squares. */
function answerSheet(items) {
  if (!items || !items.length) return '';
  const cells = items.map((it) => {
    const cls = !it.answered ? 'q-blank' : it.right ? 'q-right' : 'q-wrong';
    const brk = it.indexInModule === 0 && it.n > 1 ? ' q-modbreak' : '';
    return '<span class="q ' + cls + brk + '" title="Question ' + it.n + '">' +
           it.n + '</span>';
  }).join('');
  return '<div class="sheet">' + cells + '</div>';
}

function rowsTable(list, nameOf, heading) {
  if (!list || !list.length) return '';
  const rows = list.map((e) => {
    const b = band(e);
    return '<tr><td class="nm">' + esc(nameOf(e)) + '</td>' +
           '<td class="n">' + e.right + '/' + e.total + '</td>' +
           '<td class="n">' + pct(e) + '%</td>' +
           '<td class="gr">' + bar(e) + '</td>' +
           '<td class="n"><span class="band ' + b.cls + '">' + b.label + '</span></td></tr>';
  }).join('');
  return '<table><caption>' + esc(heading) + '</caption>' +
         '<thead><tr><th>Item</th><th class="n">Score</th><th class="n">%</th>' +
         '<th>Profile</th><th class="n">Band</th></tr></thead>' +
         '<tbody>' + rows + '</tbody></table>';
}

/* One page per question type, which is what makes this the DETAILED report. */
function qtypePages(perQType) {
  const groups = {};
  for (const e of perQType || []) {
    if (!e.qtype) continue;
    const sk = TX.skillOf(e.qtype);
    const key = sk ? sk.id : 'other';
    (groups[key] || (groups[key] = { skill: sk, rows: [] })).rows.push(e);
  }

  return Object.keys(groups).map((key) => {
    const g = groups[key];
    const sk = g.skill;
    const head = '<h2>' + esc(sk ? sk.cb : 'Other') + '</h2>' +
      (sk ? '<p class="dom">' + esc(sk.domain) + '</p>' : '');

    const body = g.rows.map((e) => {
      const q = TX.qtype(e.qtype);
      const r = TX.resources(e.qtype);
      const b = band(e);
      const links = [];
      if (r.video) links.push('<li><span class="lh">Helpful Video</span> ' +
        '<a href="' + esc(r.video) + '" target="_blank" rel="noopener">' +
        esc(q ? q.label : e.qtype) + ' &mdash; worked example on Khan Academy</a></li>');
      if (r.page) links.push('<li><span class="lh">Helpful Page</span> ' +
        '<a href="' + esc(r.page) + '" target="_blank" rel="noopener">' +
        esc(q ? q.label : e.qtype) + ' &mdash; lesson on Khan Academy</a></li>');

      return '<section class="qt">' +
        '<h3>' + esc(q ? q.label : TX.labelOf(e.qtype)) +
          ' <span class="band ' + b.cls + '">' + b.label + '</span></h3>' +
        '<p class="score">' + e.right + ' of ' + e.total + ' correct &middot; ' +
          pct(e) + '%' +
          (TX.enoughData(e.total) ? '' :
            ' <em>&mdash; too few attempts to judge; the count is real, ' +
            'the conclusion would not be</em>') +
        '</p>' + bar(e, 320) +
        (q ? '<dl>' +
          '<dt>What it asks</dt><dd>' + esc(q.asks) + '</dd>' +
          (q.cue ? '<dt>How to recognise it</dt><dd>' + esc(q.cue) + '</dd>' : '') +
          '<dt>Example</dt><dd class="ex">' + esc(q.example) + '</dd>' +
          '<dt>Usually missed by</dt><dd>' + esc(q.trap) + '</dd></dl>' : '') +
        (links.length ? '<ul class="links">' + links.join('') + '</ul>' : '') +
        '</section>';
    }).join('');

    /* The broad video sits at the end of the whole group, because it covers
       the group rather than any single question type in it. */
    const first = g.rows[0];
    const r = first ? TX.resources(first.qtype) : null;
    const oct = r && r.oct
      ? '<p class="oct"><span class="lh">Video covering everything about ' +
        esc(r.skillName || '') + '</span> ' +
        '<a href="' + esc(r.oct.url) + '" target="_blank" rel="noopener">' +
        esc(r.oct.title) + '</a></p>'
      : '';

    return '<article class="page">' + head + body + oct + '</article>';
  }).join('');
}

function buildHTML(result) {
  const d = result || {};
  const when = new Date();
  const stamp = when.toISOString().slice(0, 10) + ' ' +
                String(when.getHours()).padStart(2, '0') + ':' +
                String(when.getMinutes()).padStart(2, '0');

  const identity =
    '<header class="ident">' +
      '<div class="brand"><b>THE SAT GAME</b><span>Score Analysis</span></div>' +
      '<dl class="meta">' +
        '<dt>Run</dt><dd>' + esc(d.modeLabel || 'Practice') + '</dd>' +
        '<dt>Generated</dt><dd>' + esc(stamp) + '</dd>' +
        '<dt>Time taken</dt><dd>' + clock(d.elapsed) + '</dd>' +
      '</dl>' +
    '</header>';

  const secRows = (d.sections || []).map((s) =>
    '<tr><td class="nm">' + (s.section === 'math' ? 'Math' : 'Reading and Writing') + '</td>' +
    '<td class="n">' + s.raw + '/' + s.total + '</td>' +
    '<td class="n big">' + s.scaled + '</td>' +
    '<td class="n">' + (s.scaled - 30) + '&ndash;<b>' + s.scaled + '</b>&ndash;' + (s.scaled + 30) + '</td>' +
    '</tr>').join('');

  const scoreBlock = d.kind === 'infinity'
    ? '<p class="headline">Cleared ' + (d.cleared || 0) + ' &middot; survived ' + clock(d.elapsed) + '</p>'
    : '<div class="split">' +
        '<div><p class="headline">' + (d.totalScaled || 0) +
          '<span class="of"> / ' + (d.isFull ? 1600 : 800) + '</span></p>' +
        '<p class="sub">Raw ' + (d.rawTotal || 0) + ' of ' + (d.totalQuestions || 0) +
          ' &middot; ' + (d.answered || 0) + ' answered</p></div>' +
        '<table class="secs"><thead><tr><th>Section</th><th class="n">Raw</th>' +
          '<th class="n">Scaled</th><th class="n">Likely range</th></tr></thead>' +
          '<tbody>' + secRows + '</tbody></table>' +
      '</div>';

  const items = d.items || [];
  const right = items.filter((i) => i.right).length;
  const blank = items.filter((i) => !i.answered).length;

  return '' +
    identity +
    '<article class="page">' +
      '<h2>Summary</h2>' + scoreBlock +
      (items.length
        ? '<h3>Every question, in order</h3>' + answerSheet(items) +
          '<p class="sub">' + right + ' right &middot; ' +
          (items.length - right - blank) + ' wrong &middot; ' + blank + ' blank</p>'
        : '') +
      rowsTable(d.perDifficulty || [],
        (e) => e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1),
        'Accuracy by question difficulty') +
      rowsTable(d.perDomain || [], (e) => e.domain, 'Accuracy by content domain') +
      '<p class="note">Scores are an estimate. College Board does not publish ' +
        'the raw-to-scaled conversion, so the range is the honest form of the ' +
        'number and the single figure is its midpoint.</p>' +
    '</article>' +
    qtypePages(d.perQType || []);
}

const CSS = `
#${ID}{position:fixed;inset:0;z-index:99999;background:#f3f5f7;color:#111820;
  overflow:auto;font:14px/1.6 system-ui,"Segoe UI",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;}
#${ID} *{box-sizing:border-box}
#${ID} .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;
  align-items:center;padding:12px 20px;background:#111820;color:#f3f5f7;}
#${ID} .toolbar b{font-size:13px;letter-spacing:.14em;text-transform:uppercase;
  margin-right:auto;}
#${ID} button{font:inherit;font-size:13px;padding:7px 16px;border:1px solid #4a5763;
  background:#1d2732;color:#f3f5f7;cursor:pointer;border-radius:3px;}
#${ID} button:hover{background:#28343f}
#${ID} button:focus-visible{outline:2px solid #5fbcd8;outline-offset:2px}
#${ID} button.primary{background:#0f6e8c;border-color:#0f6e8c}
#${ID} .doc{max-width:900px;margin:0 auto;padding:24px 28px 80px}
#${ID} .ident{display:flex;justify-content:space-between;gap:24px;
  align-items:flex-start;border-bottom:2px solid #111820;padding-bottom:14px;
  margin-bottom:22px;flex-wrap:wrap}
#${ID} .brand b{display:block;font-size:20px;letter-spacing:.04em}
#${ID} .brand span{font-size:12px;letter-spacing:.16em;text-transform:uppercase;
  color:#5b6a78}
#${ID} .meta{display:grid;grid-template-columns:auto auto;gap:2px 12px;margin:0;
  font-size:12px}
#${ID} .meta dt{color:#5b6a78;text-transform:uppercase;letter-spacing:.08em}
#${ID} .meta dd{margin:0;font-weight:600}
#${ID} .page{border-bottom:1px solid #d3dae0;padding:0 0 26px;margin:0 0 26px}
#${ID} h2{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
#${ID} h3{font-size:14px;margin:20px 0 6px}
#${ID} .dom{margin:0 0 12px;font-size:11px;letter-spacing:.12em;
  text-transform:uppercase;color:#0f6e8c}
#${ID} .split{display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}
#${ID} .split>div{min-width:180px}
#${ID} .headline{font-size:46px;line-height:1;margin:6px 0 4px;
  font-variant-numeric:tabular-nums;letter-spacing:-.03em}
#${ID} .headline .of{font-size:16px;color:#5b6a78;letter-spacing:0}
#${ID} .sub{color:#5b6a78;font-size:12.5px;margin:0 0 10px}
#${ID} table{border-collapse:collapse;width:100%;margin:12px 0 4px;font-size:13px}
#${ID} .secs{width:auto;flex:1 1 320px}
#${ID} caption{text-align:left;font-size:11px;letter-spacing:.12em;
  text-transform:uppercase;color:#5b6a78;padding:10px 0 6px}
#${ID} th,#${ID} td{border-bottom:1px solid #e6ebef;padding:6px 10px;text-align:left;
  vertical-align:middle}
#${ID} thead th{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:#5b6a78;border-bottom:1px solid #b9c2ca}
#${ID} .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#${ID} .big{font-size:16px;font-weight:600}
#${ID} .nm{font-weight:600}
#${ID} .gr{width:160px}
#${ID} .bar{display:block}
#${ID} .band{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 6px;
  border-radius:3px;letter-spacing:.04em}
#${ID} .b-hi{background:#e0f0e7;color:#1c7a4a}
#${ID} .b-hiavg{background:#e6f2ea;color:#2c7d55}
#${ID} .b-avg{background:#f6ecd9;color:#8f6410}
#${ID} .b-loavg{background:#f7e7e2;color:#9a4a2f}
#${ID} .b-lo{background:#f7e4e1;color:#a3342a}
#${ID} .b-none{background:#e9edf0;color:#7b8792}
#${ID} .sheet{display:flex;flex-wrap:wrap;gap:3px;margin:8px 0 10px}
#${ID} .q{display:grid;place-items:center;width:22px;height:22px;font-size:9.5px;
  color:#fff;border-radius:2px;font-variant-numeric:tabular-nums}
#${ID} .q-right{background:#1c7a4a}
#${ID} .q-wrong{background:#a3342a}
#${ID} .q-blank{background:#b9bfc4;color:#3b444c}
#${ID} .q-modbreak{margin-left:12px;box-shadow:-7px 0 0 -5px #111820}
#${ID} .qt{border-top:1px solid #e6ebef;padding:14px 0 4px}
#${ID} .qt h3{display:flex;gap:10px;align-items:center;margin:0 0 4px;font-size:15px}
#${ID} .score{margin:0 0 6px;font-size:12.5px;color:#2b3644}
#${ID} .score em{color:#8f6410;font-style:normal}
#${ID} dl{margin:10px 0 8px;display:grid;grid-template-columns:132px 1fr;gap:4px 14px}
#${ID} dt{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:#5b6a78;padding-top:2px}
#${ID} dd{margin:0}
#${ID} .ex{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;
  background:#eef1f4;padding:6px 9px;border-radius:3px}
#${ID} .links{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:5px}
#${ID} .lh{display:inline-block;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:#5b6a78;min-width:96px}
#${ID} a{color:#0f6e8c}
#${ID} .oct{margin:14px 0 0;padding:10px 12px;background:#e2f0f5;border-radius:3px;
  font-size:13px}
#${ID} .note{margin:18px 0 0;font-size:11.5px;color:#5b6a78;font-style:italic}

@media print{
  #${ID}{position:static;overflow:visible;background:#fff}
  #${ID} .toolbar{display:none}
  #${ID} .doc{max-width:none;padding:0}
  #${ID} .page{break-inside:avoid;page-break-inside:avoid;border-bottom:none;
    padding-bottom:0}
  #${ID} .qt{break-inside:avoid;page-break-inside:avoid}
  #${ID} .ident{position:running(ident)}
  #${ID} a{text-decoration:underline}
  /* A printed link is useless unless the address is on the paper. */
  #${ID} .links a::after,#${ID} .oct a::after{content:" (" attr(href) ")";
    font-size:9.5px;color:#444;word-break:break-all}
}
`;

/* Everything above the game is inert until this runs, and the layer is
   destroyed rather than hidden on close. */
function open(result, closeCb) {
  close();
  onClose = closeCb || null;

  host = global.document.createElement('div');
  host.id = ID;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Printable score analysis');

  const style = global.document.createElement('style');
  style.textContent = CSS;

  const toolbar = global.document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = '<b>Printable report</b>' +
    '<button type="button" data-act="print" class="primary">Print</button>' +
    '<button type="button" data-act="close">Close</button>';

  const doc = global.document.createElement('div');
  doc.className = 'doc';
  doc.innerHTML = buildHTML(result);

  host.appendChild(style);
  host.appendChild(toolbar);
  host.appendChild(doc);
  global.document.body.appendChild(host);

  host.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    if (b.dataset.act === 'print') global.print();
    else close();
  });

  /* The game listens on window for keys. While this layer is up those must not
     reach it, or ESC would close the report AND leave the analysis screen
     underneath in one press. */
  host.tabIndex = -1;
  host.focus();
  host.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });

  return host;
}

function close() {
  if (!host) return false;
  if (host.parentNode) host.parentNode.removeChild(host);
  host = null;
  const cb = onClose;
  onClose = null;
  if (cb) cb();
  return true;
}

function isOpen() { return !!host; }

SATG.printDoc = { open, close, isOpen, buildHTML };

})(window);
