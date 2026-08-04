/* =========================================================================
   sat/taxonomy.js - what, exactly, the player got wrong.

   The old stats screen could tell a student "work on Algebra". That is not
   help. Algebra is a third of the Math section; a student who is fluent at
   solving 3x + 7 = 19 and cannot write the equation of a line through two
   points is told the same sentence as a student in the opposite position.

   So this file carries four levels instead of two:

     SECTION   Math, or Reading and Writing
     DOMAIN    the four content domains per section
     SKILL     College Board's own "skill/knowledge testing point"
     QTYPE     the specific form the question took

   The first three levels are not invented here. They are transcribed from
   Appendix B of the College Board's "Assessment Framework for the Digital SAT
   Suite" (Tables A33-A37), which is the finest grain College Board publishes.
   Where a skill name appears in quotes in the `cb` field below, that is their
   wording, not a paraphrase - so a student who searches for it finds official
   material rather than our rename of it.

   The fourth level is ours, and it is the reason this file exists. One skill
   can be asked in several genuinely different ways, and a student is regularly
   fine at some and lost at others. "Percentages" is one College Board skill and
   four different questions:

     find 20% of 400          - arithmetic
     a price rises 20%        - one growth factor
     up 25%, then down 20%    - compounding, and the trap of adding instead
     after +25% it is 500     - running the factor backwards

   Reporting those as one number hides the only thing worth knowing. Each is a
   QTYPE here, and each is reported separately.

   ---------------------------------------------------------------- sample size

   Splitting finely has a cost: a leaf can collect one attempt and read 0%. So
   MIN_CLAIM is the number of attempts required before this file will let a
   screen make a CLAIM about a question type ("you are weak here"). Below it,
   the raw count is still shown - a student is entitled to see 0/1 - but it is
   labelled as too little to judge. Showing a number is not the same as
   asserting what it means.

   ------------------------------------------------------------------ the links

   Every question type carries study links. Two rules, both learned the hard
   way while building this:

   1. Khan Academy is a client-side app. Fetching a nonexistent Khan URL
      returns HTTP 200 and an empty shell that is byte-identical to a real
      page, so "the fetch succeeded" proves nothing at all. Only a rendered
      page distinguishes them: a real one titles itself "SAT Math | Test prep",
      a fake one "Page not found". Every URL in the tables below was taken from
      the href of a link on Khan's own rendered course page - not assembled
      from a pattern. The hash segment (x0fcc98a58ba3bea7) is unguessable,
      which is the point: a URL containing it was read, not constructed.

   2. A question type with no verified deep link falls back to its skill's
      link, and a skill with none falls back to its domain's course unit. The
      fallback chain always terminates on a URL that was read from the DOM, so
      there is no path through this file that hands a student a dead link.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;

/* Attempts needed before a claim about a question type is allowed. Four is
   the same threshold the domain-level strengths/weaknesses already used. */
const MIN_CLAIM = 4;

const KA = 'https://www.khanacademy.org';

/* ------------------------------------------------------------------ domains */

const SEC_MATH = 'math';
const SEC_RW   = 'rw';

/* These strings must equal the ones the generators stamp, or the analysis
   silently files everything under "unknown". verify() checks it. */
const D_ALG   = 'Algebra';
const D_ADV   = 'Advanced Math';
const D_PSDA  = 'Problem-Solving and Data Analysis';
const D_GEO   = 'Geometry and Trigonometry';
const D_CRAFT = 'Craft and Structure';
const D_INFO  = 'Information and Ideas';
const D_CONV  = 'Standard English Conventions';
const D_EXPR  = 'Expression of Ideas';

/* =========================================================== Khan resources

   The two SAT courses do not share a URL convention, and every difference below
   is a way a hand-assembled URL goes wrong:

     Math   /test-prep/v2-sat-math            hash x0fcc98a58ba3bea7
            unit is <domain>-<tier>           tier LAST
     R&W    /test-prep/sat-reading-and-writing  hash x0d47bcec73eb6c4b
            unit is <tier>-<domain>           tier FIRST

   The `v2-` prefix is Math-only. This file previously used
   /test-prep/v2-sat-reading for Reading and Writing, which renders "Page not
   found" - caught by loading it in a browser, which is the only check that can
   catch it, because the server returns HTTP 200 for any path under
   khanacademy.org and the SPA decides afterwards.

   Slugs are also not derivable from lesson names. Math video slugs are opaque
   codes (sat-math-q2-easier), and one lesson even renames itself between tiers
   (solving-linear-equations-and-inequalities at easier and harder,
   ...-and-linear-inequalities at medium). Every slug in the tables below was
   read from an href on Khan's own rendered course page. */

const M_HASH = 'x0fcc98a58ba3bea7';
const M_TIER = 'medium';
const M_BASE = KA + '/test-prep/v2-sat-math/' + M_HASH + ':';

const R_HASH = 'x0d47bcec73eb6c4b';
const R_BASE = KA + '/test-prep/sat-reading-and-writing/' + R_HASH + ':';

/* Domain -> course unit. The terminal fallback: every question type can reach
   one of these even with no lesson of its own. */
const UNIT = {
  [D_ALG]:  M_BASE + 'algebra-' + M_TIER,
  [D_ADV]:  M_BASE + 'advanced-math-' + M_TIER,
  [D_PSDA]: M_BASE + 'problem-solving-and-data-analysis-' + M_TIER,
  [D_GEO]:  M_BASE + 'geometry-and-trigonometry-' + M_TIER
};

/* Khan merges Expression of Ideas and Standard English Conventions into one
   R&W unit, so two of our four domains share a unit here. That is Khan's
   grouping, not a mistake in ours. */
const RW_COURSE = KA + '/test-prep/sat-reading-and-writing';
const RW_UNIT = {
  [D_INFO]:  R_BASE + 'medium-information-and-ideas',
  [D_CRAFT]: R_BASE + 'medium-craft-and-structure',
  [D_EXPR]:  R_BASE + 'medium-expression-of-ideas-and-standard-english-conventions',
  [D_CONV]:  R_BASE + 'medium-expression-of-ideas-and-standard-english-conventions'
};

/* Lesson tables: key -> { u: unit slug, v: video slug, a: article slug,
   e: exercise slug }. `v` is a worked example, `a` a lesson or grammar guide,
   `e` practice - which is exactly the "Helpful Video" / "Helpful Page" pair. */

const M_LESSON = {
  'solving-linear-equations-and-linear-inequalities':
    { u: 'algebra', v: 'sat-math-h6-easier', a: 'solving-linear-equations-and-inequalities', e: 'v2-solving-linear-equations-and-inequalities-2' },
  'linear-equation-word-problems':
    { u: 'algebra', v: 'sat-linear-equation-easier', a: 'understanding-linear-relationships', e: 'v2-linear-equation-word-problems-2' },
  'linear-relationship-word-problems':
    { u: 'algebra', v: 'sat-math-h8-easier', a: 'understanding-linear-relationships', e: 'v2-linear-relationship-word-problems-2' },
  'graphs-of-linear-equations-and-functions':
    { u: 'algebra', v: 'sat-math-h9-easier', a: 'graphs-of-linear-equations-and-functions', e: 'v2-graphs-of-linear-equations-and-functions-2' },
  'solving-systems-of-linear-equations':
    { u: 'algebra', v: 'sat-math-h7-easier', a: 'solving-systems-of-linear-equations', e: 'v2-solving-systems-of-linear-equations-2' },
  'systems-of-linear-equations-word-problems':
    { u: 'algebra', v: 'sat-math-h5-easier', a: 'systems-of-linear-equations-word-problems', e: 'v2-systems-of-linear-equations-word-problems-2' },
  'linear-inequality-word-problems':
    { u: 'algebra', v: 'sat-math-h2-easier', a: 'linear-inequality-word-problems', e: 'v2-linear-inequality-word-problems-2' },
  'graphs-of-linear-systems-and-inequalities':
    { u: 'algebra', v: 'sat-math-graphs-of-linear-systems-easier', a: 'graphs-of-linear-systems-and-inequalities', e: 'v2-graphs-of-linear-systems-and-inequalities-2' },

  'factoring-quadratic-and-polynomial-expressions':
    { u: 'advanced-math', v: 'sat-math-p4-easier', a: 'factoring-quadratic-and-polynomial-expressions', e: 'v2-factoring-quadratic-and-polynomial-expressions-2' },
  'operations-with-polynomials':
    { u: 'advanced-math', v: 'sat-math-p6-easier', a: 'operations-with-polynomials', e: 'v2-operations-with-polynomials-2' },
  'operations-with-rational-expressions':
    { u: 'advanced-math', v: 'sat-math-p9-easier', a: 'operations-with-rational-expressions', e: 'v2-operations-with-rational-expressions-2' },
  'radicals-and-rational-exponents':
    { u: 'advanced-math', v: 'sat-math-p3-easier', a: 'radicals-and-rational-exponents', e: 'v2-radicals-and-rational-exponents-2' },
  'solving-quadratic-equations':
    { u: 'advanced-math', v: 'sat-math-p5-easier', a: 'solving-quadratic-equations', e: 'v2-solving-quadratic-equations-2' },
  'quadratic-graphs':
    { u: 'advanced-math', v: 'sat-math-p12-easier', a: 'quadratic-graphs', e: 'v2-quadratic-graphs-2' },
  'exponential-graphs':
    { u: 'advanced-math', v: 'sat-math-exponential-graphs-easier', a: 'exponential-graphs', e: 'v2-exponential-graphs-2' },
  'nonlinear-functions':
    { u: 'advanced-math', v: 'sat-math-p13-easier', a: 'nonlinear-functions', e: 'v2-nonlinear-functions-2' },
  'polynomial-and-other-nonlinear-graphs':
    { u: 'advanced-math', v: 'sat-math-p11-easier', a: 'polynomial-and-other-nonlinear-graphs', e: 'v2-polynomial-and-other-nonlinear-graphs-2' },
  'radical-rational-and-absolute-value-equations':
    { u: 'advanced-math', v: 'sat-math-p7-easier', a: 'radical-rational-and-absolute-value-equations', e: 'v2-radical-rational-and-absolute-value-equations-2' },
  'linear-and-quadratic-systems':
    { u: 'advanced-math', v: 'sat-math-p8-easier', a: 'linear-and-quadratic-systems', e: 'v2-linear-and-quadratic-systems-2' },
  'quadratic-and-exponential-word-problems':
    { u: 'advanced-math', v: 'sat-math-p10-easier', a: 'quadratic-and-exponential-word-problems', e: 'v2-quadratic-and-exponential-word-problems-2' },
  'isolating-quantities':
    { u: 'advanced-math', v: 'sat-math-p14-easier', a: 'isolating-quantities', e: 'v2-isolating-quantities-2' },

  'ratios-rates-and-proportions':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q1-easier', a: 'ratios-rates-and-proportions', e: 'v2-ratios-rates-and-proportions-2' },
  'percentages':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q2-easier', a: 'percentages', e: 'v2-percentages-2' },
  'unit-conversion':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q3-easier', a: 'unit-conversion', e: 'v2-unit-conversion-2' },
  'scatterplots':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q4-easier', a: 'scatterplots', e: 'v2-scatterplots-2' },
  'data-representations':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q5-easier', a: 'data-representations', e: 'v2-data-representations-2' },
  'linear-and-exponential-growth':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q6-easier', a: 'linear-and-exponential-growth', e: 'v2-linear-and-exponential-growth-2' },
  'probability-and-relative-frequency':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q7-easier', a: 'probability-and-relative-frequency', e: 'v2-probability-and-relative-frequency-2' },
  'data-inferences':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q8-easier', a: 'data-inferences', e: 'v2-data-inferences-2' },
  'center-spread-and-shape-of-distributions':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q9-easier', a: 'center-spread-and-shape-of-distributions', e: 'v2-center-spread-and-shape-of-distributions-2' },
  'evaluating-statistical-claims':
    { u: 'problem-solving-and-data-analysis', v: 'sat-math-q10-easier', a: 'evaluating-statistical-claims', e: 'v2-evaluating-statistical-claims-2' },

  'area-and-volume':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s1-easier', a: 'area-and-volume', e: 'v2-area-and-volume-2' },
  'unit-circle-trigonometry':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s4-easier', a: 'unit-circle-trigonometry', e: 'v2-unit-circle-trigonometry-2' },
  'circle-theorems':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s5-easier', a: 'circle-theorems', e: 'v2-circle-theorems-2' },
  'congruence-similarity-and-angle-relationships':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s6-easier', a: 'congruence-similarity-and-angle-relationships', e: 'v2-congruence-similarity-and-angle-relationships-2' },
  'right-triangle-trigonometry':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s7-easier', a: 'right-triangle-trigonometry', e: 'v2-right-triangle-trigonometry-2' },
  'circle-equations':
    { u: 'geometry-and-trigonometry', v: 'sat-math-s8-easier', a: 'circle-equations', e: 'v2-circle-equations-2' }
};

/* Math article slugs all carry a shared prefix; kept out of the table above so
   the table reads as lesson names rather than as boilerplate. */
const M_ARTICLE_PREFIX = 'v2-sat-lesson-';

const R_LESSON = {
  'central-ideas-and-details':
    { u: 'medium-information-and-ideas', v: 'central-ideas-and-details-worked-example', a: 'central-ideas-and-details-lesson', e: 'central-ideas-and-details-medium' },
  'command-of-evidence-textual':
    { u: 'medium-information-and-ideas', v: 'v2-sat-command-of-evidence-textual-video', a: 'command-of-evidence-textual-lesson', e: 'command-of-textual-evidence-medium' },
  'command-of-evidence-quantitative':
    { u: 'medium-information-and-ideas', v: 'command-of-quantitative-evidence-reading-and-writing-test-sat-khan-academy', a: 'command-of-evidence-quantitative-lesson', e: 'command-of-quantitative-evidence-medium' },
  'inferences':
    { u: 'medium-information-and-ideas', v: 'inferences-worked-example', a: 'inferences-lesson', e: 'inferences-medium' },

  'words-in-context':
    { u: 'medium-craft-and-structure', v: 'words-in-context-worked-example', a: 'words-in-context-lesson', e: 'words-in-context-medium' },
  'text-structure-and-purpose':
    { u: 'medium-craft-and-structure', v: 'text-structure-and-purpose-video', a: 'text-structure-and-purpose-lesson', e: 'text-structure-and-purpose-medium' },
  'cross-text-connections':
    { u: 'medium-craft-and-structure', v: 'cross-text-connections-video', a: 'cross-text-connections-lesson', e: 'cross-text-connections-medium' },

  'rhetorical-synthesis':
    { u: 'medium-expression-of-ideas-and-standard-english-conventions', v: 'rhetorical-synthesis-worked-example', a: 'rhetorical-synthesis-lesson', e: 'rhetorical-synthesis-medium' },
  'transitions':
    { u: 'medium-expression-of-ideas-and-standard-english-conventions', v: 'transitions-worked-example', a: 'transitions-lesson', e: 'transitions-medium' },

  /* The grammar-practice unit is the find of the whole exercise: Khan splits
     Standard English Conventions into exactly the seven fine-grained types this
     taxonomy derived independently from Appendix B, and gives each its own
     grammar guide and worked example. */
  'boundaries-punctuation':
    { u: 'digital-sat-grammar-practice', v: 'boundaries-punctuation-worked-example', a: 'grammar-guide-punctuation', e: 'practice-punctuation' },
  'boundaries-linking-clauses':
    { u: 'digital-sat-grammar-practice', v: 'linking-clauses-video', a: 'grammar-guide-linking-clauses', e: 'practice-linking-clauses' },
  'boundaries-supplements':
    { u: 'digital-sat-grammar-practice', v: 'boundaries-supplements-worked-example', a: 'boundaries-grammar-guide-supplements', e: 'practice-supplements' },
  'fss-sva':
    { u: 'digital-sat-grammar-practice', v: 'subject-verb-agreement-worked-example', a: 'fss-grammar-guide-subject-verb-agreement', e: 'subject-verb-agreement-practice' },
  'fss-pronoun-antecedent-agreement':
    { u: 'digital-sat-grammar-practice', v: 'pronoun-antecedent-agreement-video', a: 'fss-grammar-guide-pronoun-antecedent-agreement', e: 'fss-pronoun-antecedent-agreement-practice' },
  'fss-plurals-and-possessives':
    { u: 'digital-sat-grammar-practice', v: 'plural-possession-worked-example', a: 'fss-grammar-guide-plurals-and-possessives', e: 'fss-plurals-and-possessives-practice' },
  'fss-subject-modifier-placement':
    { u: 'digital-sat-grammar-practice', v: 'subject-modifier-placement-worked-example', a: 'fss-grammar-guide-subject-modifier-placement', e: 'fss-subject-modifier-placement-practice' },
  'fss-verb-forms':
    { u: 'digital-sat-grammar-practice', v: 'verb-form-worked-example', a: 'grammar-guide-verb-forms', e: 'fss-verb-forms-practice' }
};

/* Build the three URLs for a lesson key, whichever course it belongs to. */
function lessonLinks(key) {
  const m = M_LESSON[key];
  if (m) {
    const unit = M_BASE + m.u + '-' + M_TIER;
    const lesson = unit + '/' + M_HASH + ':' + key + '-' + M_TIER;
    return {
      video: lesson + '/v/' + m.v,
      page:  lesson + '/a/' + M_ARTICLE_PREFIX + m.a,
      practice: lesson + '/e/' + m.e
    };
  }
  const r = R_LESSON[key];
  if (r) {
    const lesson = R_BASE + r.u + '/' + R_HASH + ':' + key;
    return {
      video: lesson + '/v/' + r.v,
      page:  lesson + '/a/' + r.a,
      practice: lesson + '/e/' + r.e
    };
  }
  return null;
}

/* ------------------------------------------- Organic Chemistry Tutor videos

   Every id below was checked through YouTube's oEmbed endpoint, which resolves
   only for videos that exist and returns the channel's real name - so a
   wrong-channel lookalike is rejected rather than shipped. A deliberately
   invalid id returns HTTP 400, which is what makes the check worth running.

   These sit at SKILL level, because his videos cover a broad topic, which is
   the level a skill sits at. A question type may override with its own when the
   skill spans more ground than one video does. He does not cover Reading and
   Writing at all, and no stand-in is invented for it. */
const OCT = {
  linearEquations:  { id: '7DPWeBszNSM', title: 'How To Solve Linear Equations In Algebra' },
  linearGraphs:     { id: 'Ft2_QtXAnh8', title: 'Linear Equations - Algebra' },
  systems:          { id: 'oKqtgz2eo-Y', title: 'Solving Systems of Equations By Elimination & Substitution' },
  inequalities:     { id: 'DrZJKdXlZ3I', title: 'How To Solve Linear Inequalities' },
  factoring:        { id: 'mXvt9OumKH8', title: 'Factoring Polynomials - By GCF, AC Method, Grouping, Substitution' },
  exponents:        { id: 'etMK3xViMAc', title: 'Properties of Exponents - Algebra 2' },
  quadratics:       { id: 'qwpxeaz2GBI', title: 'Solving Quadratic Equations Using The Quadratic Formula & By Factoring' },
  parabolas:        { id: 'Hq2Up_1Ih5E', title: 'Graphing Quadratic Functions in Vertex & Standard Form' },
  exponentialFns:   { id: 'e5nwJKUc3bA', title: 'Exponential Growth and Decay Word Problems & Functions' },
  functions:        { id: 'HyNie_PYgsY', title: 'Evaluating Functions - Basic Introduction | Algebra' },
  radicals:         { id: '3LN0IDooaIE', title: 'Solving Absolute Value Equations and Inequalities' },
  ratios:           { id: 's0RBRkehzwo', title: 'Unit Rates, Ratios & Proportions - Word Problems' },
  percentages:      { id: 'T6-0MwmCpE8', title: 'Percent Increase and Decrease Word Problems' },
  units:            { id: 'MqDYkUBL8n8', title: 'Converting Units With Conversion Factors - Dimensional Analysis' },
  statistics:       { id: 'W8NaUtkM46o', title: 'Data & Statistics - Mean, Median, Mode, Range, & Standard Deviation - SAT Math Part 44' },
  statsOverview:    { id: 'XZo4xyJXCak', title: 'Introduction to Statistics' },
  regression:       { id: 'P8hT5nDai6A', title: 'Linear Regression Using Least Squares Method - Line of Best Fit' },
  probability:      { id: 'SkidyDQuupA', title: 'Introduction to Probability, Basic Overview' },
  probTables:       { id: 'sqDVrXq_eh0', title: 'Conditional Probability With Venn Diagrams & Contingency Tables' },
  marginOfError:    { id: 'DT-fPG0Hff8', title: 'How To Find The Z Score, Confidence Interval, and Margin of Error' },
  angles:           { id: 'oeO8f0taQDA', title: 'Lines, Rays, Line Segments, Points, Angles' },
  similarity:       { id: 'VXlFEilh-cw', title: 'Triangle Similarity - AA SSS SAS & AAA Postulates' },
  pythagorean:      { id: 'd8EA5TxGzcY', title: 'Pythagorean Theorem' },
  specialTriangles: { id: 'p70UBGCHZrQ', title: 'Special Right Triangles - 30 60 90 | SAT Math' },
  area:             { id: 'JnLDmw3bbuw', title: 'Area of a Rectangle, Triangle, Circle & Sector, Trapezoid, Square' },
  geometry:         { id: 'KtZai86htng', title: 'Geometry Introduction - Review For SAT, ACT, EOC' },
  circles:          { id: 'Fzaof9cX-PM', title: 'Circles In Geometry - Circumference, Area, Arc Length, Inscribed Angles' },
  trigonometry:     { id: 'PUB0TaZ7bhA', title: 'Trigonometry For Beginners!' },
  unitCircle:       { id: 'V5ArB_GFGYQ', title: 'Unit Circle Trigonometry - Sin Cos Tan - Radians & Degrees' }
};

function octLink(entry) {
  if (!entry) return null;
  return { url: 'https://www.youtube.com/watch?v=' + entry.id, title: entry.title };
}

/* ------------------------------------------------------------------- skills */

/* `cb` is College Board's published name for the testing point, verbatim.
   `oct` is the long-form Organic Chemistry Tutor video for the whole skill -
   attached here rather than to a question type because his videos cover a
   broad topic, which is the level a skill sits at. */
const SKILLS = [
  /* ---- Math: Algebra */
  { id: 'alg-lin1', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear equations in one variable',
    ka: 'solving-linear-equations-and-linear-inequalities', oct: OCT.linearEquations },
  { id: 'alg-lin2', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear equations in two variables',
    ka: 'graphs-of-linear-equations-and-functions', oct: OCT.linearGraphs },
  { id: 'alg-linfn', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear functions',
    ka: 'linear-relationship-word-problems', oct: OCT.linearGraphs },
  { id: 'alg-sys', section: SEC_MATH, domain: D_ALG,
    cb: 'Systems of two linear equations in two variables',
    ka: 'solving-systems-of-linear-equations', oct: OCT.systems },
  { id: 'alg-ineq', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear inequalities in one or two variables',
    ka: 'linear-inequality-word-problems', oct: OCT.inequalities },

  /* ---- Math: Advanced Math */
  { id: 'adv-equiv', section: SEC_MATH, domain: D_ADV,
    cb: 'Equivalent expressions',
    ka: 'factoring-quadratic-and-polynomial-expressions', oct: OCT.factoring },
  { id: 'adv-nleq', section: SEC_MATH, domain: D_ADV,
    cb: 'Nonlinear equations in one variable and systems of equations in two variables',
    ka: 'solving-quadratic-equations', oct: OCT.quadratics },
  { id: 'adv-nlfn', section: SEC_MATH, domain: D_ADV,
    cb: 'Nonlinear functions',
    ka: 'nonlinear-functions', oct: OCT.functions },

  /* ---- Math: Problem-Solving and Data Analysis */
  { id: 'psda-ratio', section: SEC_MATH, domain: D_PSDA,
    cb: 'Ratios, rates, proportional relationships, and units',
    ka: 'ratios-rates-and-proportions', oct: OCT.ratios },
  { id: 'psda-pct', section: SEC_MATH, domain: D_PSDA,
    cb: 'Percentages',
    ka: 'percentages', oct: OCT.percentages },
  { id: 'psda-1var', section: SEC_MATH, domain: D_PSDA,
    cb: 'One-variable data: distributions and measures of center and spread',
    ka: 'center-spread-and-shape-of-distributions', oct: OCT.statistics },
  { id: 'psda-2var', section: SEC_MATH, domain: D_PSDA,
    cb: 'Two-variable data: models and scatterplots',
    ka: 'scatterplots', oct: OCT.regression },
  { id: 'psda-prob', section: SEC_MATH, domain: D_PSDA,
    cb: 'Probability and conditional probability',
    ka: 'probability-and-relative-frequency', oct: OCT.probability },
  { id: 'psda-infer', section: SEC_MATH, domain: D_PSDA,
    cb: 'Inference from sample statistics and margin of error',
    ka: 'data-inferences', oct: OCT.marginOfError },
  { id: 'psda-claims', section: SEC_MATH, domain: D_PSDA,
    cb: 'Evaluating statistical claims: observational studies and experiments',
    ka: 'evaluating-statistical-claims', oct: OCT.statsOverview },

  /* ---- Math: Geometry and Trigonometry */
  { id: 'geo-areavol', section: SEC_MATH, domain: D_GEO,
    cb: 'Area and volume',
    ka: 'area-and-volume', oct: OCT.area },
  { id: 'geo-lines', section: SEC_MATH, domain: D_GEO,
    cb: 'Lines, angles, and triangles',
    ka: 'congruence-similarity-and-angle-relationships', oct: OCT.angles },
  { id: 'geo-right', section: SEC_MATH, domain: D_GEO,
    cb: 'Right triangles and trigonometry',
    ka: 'right-triangle-trigonometry', oct: OCT.pythagorean },
  { id: 'geo-circle', section: SEC_MATH, domain: D_GEO,
    cb: 'Circles',
    ka: 'circle-theorems', oct: OCT.circles },

  /* ---- R&W: Information and Ideas */
  { id: 'rw-central', section: SEC_RW, domain: D_INFO,
    cb: 'Central Ideas and Details',
    ka: 'central-ideas-and-details' },
  { id: 'rw-evidence-text', section: SEC_RW, domain: D_INFO,
    cb: 'Command of Evidence: Textual',
    ka: 'command-of-evidence-textual' },
  { id: 'rw-evidence-quant', section: SEC_RW, domain: D_INFO,
    cb: 'Command of Evidence: Quantitative',
    ka: 'command-of-evidence-quantitative' },
  { id: 'rw-infer', section: SEC_RW, domain: D_INFO,
    cb: 'Inferences',
    ka: 'inferences' },

  /* ---- R&W: Craft and Structure */
  { id: 'rw-words', section: SEC_RW, domain: D_CRAFT,
    cb: 'Words in Context',
    ka: 'words-in-context' },
  { id: 'rw-structure', section: SEC_RW, domain: D_CRAFT,
    cb: 'Text Structure and Purpose',
    ka: 'text-structure-and-purpose' },
  { id: 'rw-crosstext', section: SEC_RW, domain: D_CRAFT,
    cb: 'Cross-Text Connections',
    ka: 'cross-text-connections' },

  /* ---- R&W: Expression of Ideas */
  { id: 'rw-synthesis', section: SEC_RW, domain: D_EXPR,
    cb: 'Rhetorical Synthesis',
    ka: 'rhetorical-synthesis' },
  { id: 'rw-transitions', section: SEC_RW, domain: D_EXPR,
    cb: 'Transitions',
    ka: 'transitions' },

  /* ---- R&W: Standard English Conventions.
     College Board splits this domain into two skills, each with named
     sub-points; those sub-points are the question types below. This is the
     part the old code collapsed hardest: five different generators all
     reported themselves as "form-structure-sense". */
  { id: 'rw-boundaries', section: SEC_RW, domain: D_CONV,
    cb: 'Boundaries',
    ka: 'boundaries-punctuation' },
  { id: 'rw-fss', section: SEC_RW, domain: D_CONV,
    cb: 'Form, Structure, and Sense',
    ka: 'fss-sva' }
];

/* ------------------------------------------------------------- question types

   Fields:
     id       stamped onto every generated question; the join key for stats
     skill    parent skill id
     label    short name, for a bar chart row
     asks     what the question puts in front of you, in plain English
     example  a representative stem, in the shape this game actually generates
     trap     the mistake the distractors are built to catch

   `asks` and `trap` are the two lines that make a report useful: one says what
   the task was, the other says how it is usually failed. */
const QTYPES = [
  /* ================================================== Algebra */
  { id: 'alg-lin1-solve', skill: 'alg-lin1', ka: 'solving-linear-equations-and-linear-inequalities',
    label: 'Solve a linear equation',
    asks: 'One equation, one unknown, no context. Collect the x terms on one side and the numbers on the other.',
    example: '7x - 4 = 3x + 16.  What is the value of x ?',
    trap: 'Losing a sign when moving a term across, or reporting the value of the expression instead of x.' },

  { id: 'alg-lin1-count', skill: 'alg-lin1', ka: 'solving-linear-equations-and-linear-inequalities',
    label: 'No solution or infinitely many',
    asks: 'A linear equation with a letter in place of a coefficient, asking when it has no solution, one, or infinitely many.',
    example: 'For what value of a does 4x + 9 = ax + 9 have infinitely many solutions?',
    trap: 'Treating "no solution" and "infinitely many" as the same case. They differ only in the constants.' },

  { id: 'alg-lin2-write', skill: 'alg-lin2', ka: 'graphs-of-linear-equations-and-functions',
    label: 'Write the equation of a line',
    asks: 'Given two points, or a point and a slope, or a parallel or perpendicular line, produce the equation.',
    example: 'Line k passes through (2, -3) and is perpendicular to y = 4x + 1. What is the equation of k ?',
    trap: 'Using the slope as given for a perpendicular line instead of the negative reciprocal.' },

  { id: 'alg-linfn-evaluate', skill: 'alg-linfn', ka: 'linear-relationship-word-problems',
    label: 'Evaluate a linear model',
    asks: 'A linear function models a real quantity. Substitute the given input and report the output.',
    example: 'V(t) = -18t + 900 models litres remaining after t minutes. What is V(12) ?',
    trap: 'Dropping the starting value and reporting only the rate times the time.' },

  { id: 'alg-linfn-interpret', skill: 'alg-linfn', ka: 'linear-relationship-word-problems',
    label: 'Interpret slope and intercept',
    asks: 'No arithmetic at all. Say what one of the two numbers in the model MEANS in the situation described.',
    example: 'In V(t) = -18t + 900, which statement best interprets the -18 ?',
    trap: 'Swapping the two roles: describing the intercept when asked about the rate, or reading a decrease as an increase.' },

  { id: 'alg-sys-solve', skill: 'alg-sys', ka: 'solving-systems-of-linear-equations',
    label: 'Solve a system of two equations',
    asks: 'Two linear equations in x and y. Solve for one variable, or for a combination such as x + y.',
    example: '3x + 2y = 19,  5x - 2y = 5.  What is the value of x + y ?',
    trap: 'Solving correctly and then answering the wrong question - giving x when x + y was asked for.' },

  { id: 'alg-sys-count', skill: 'alg-sys', ka: 'solving-systems-of-linear-equations',
    label: 'How many solutions a system has',
    asks: 'Whether two lines meet once, never, or everywhere - decided by comparing coefficients, not by solving.',
    example: '2x + 3y = 7,  6x + 9y = 14.  How many solutions does the system have?',
    trap: 'Answering "exactly two", carried over from quadratics. Two lines can never meet twice.' },

  { id: 'alg-ineq-solve', skill: 'alg-ineq', ka: 'linear-inequality-word-problems',
    label: 'Solve a linear inequality',
    asks: 'Isolate x in an inequality, then give the least or greatest integer that satisfies it.',
    example: '5x - 3 <= 27.  What is the greatest integer value of x that satisfies the inequality?',
    trap: 'Rounding the wrong way at the boundary, or forgetting to flip the sign when dividing by a negative.' },

  /* ============================================ Advanced Math */
  { id: 'adv-equiv-diffsquares', skill: 'adv-equiv', ka: 'factoring-quadratic-and-polynomial-expressions',
    label: 'Difference of two squares',
    asks: 'Recognise a squared term minus a squared term and split it into two brackets.',
    example: 'Which expression is equivalent to 16x^2 - 49 ?',
    trap: 'Treating it as a perfect square, giving (4x - 7)^2 instead of (4x - 7)(4x + 7).' },

  { id: 'adv-equiv-expand', skill: 'adv-equiv', ka: 'operations-with-polynomials',
    label: 'Multiply two binomials',
    asks: 'Expand two brackets into a trinomial.',
    example: 'Which expression is equivalent to (x + 5)(x - 3) ?',
    trap: 'Losing the cross terms, so x^2 - 15 is offered instead of x^2 + 2x - 15.' },

  { id: 'adv-equiv-factor', skill: 'adv-equiv', ka: 'factoring-quadratic-and-polynomial-expressions',
    label: 'Factor a trinomial',
    asks: 'Run the expansion backwards: find two numbers with the right product and the right sum.',
    example: 'Which expression is equivalent to x^2 - 7x + 12 ?',
    trap: 'Getting the pair right and both signs wrong, giving (x + 3)(x + 4).' },

  { id: 'adv-equiv-exponent-product', skill: 'adv-equiv', ka: 'radicals-and-rational-exponents', oct: OCT.exponents,
    label: 'Multiplying powers',
    asks: 'Powers of the same base multiplied together.',
    example: 'Which expression is equivalent to (5x^3)(x^4) ?',
    trap: 'Multiplying the exponents instead of adding them.' },

  { id: 'adv-equiv-exponent-power', skill: 'adv-equiv', ka: 'radicals-and-rational-exponents', oct: OCT.exponents,
    label: 'A power raised to a power',
    asks: 'A whole bracket, coefficient included, raised to an exponent.',
    example: 'Which expression is equivalent to (3x^2)^4 ?',
    trap: 'Raising only the variable and leaving the coefficient alone.' },

  { id: 'adv-equiv-exponent-quotient', skill: 'adv-equiv', ka: 'radicals-and-rational-exponents', oct: OCT.exponents,
    label: 'Dividing powers',
    asks: 'Powers of the same base divided.',
    example: 'Which expression is equivalent to (x^9)/(x^4) ?',
    trap: 'Adding the exponents, or dividing them.' },

  { id: 'adv-equiv-exponent-negative', skill: 'adv-equiv', ka: 'radicals-and-rational-exponents', oct: OCT.exponents,
    label: 'Negative exponents',
    asks: 'What a negative exponent does, and what it leaves alone.',
    example: 'Which expression is equivalent to 6x^(-3) ?',
    trap: 'Dragging the coefficient into the denominator too, or turning the negative exponent into a minus sign.' },

  { id: 'adv-nleq-quad-roots', skill: 'adv-nleq', ka: 'solving-quadratic-equations',
    label: 'Solve a quadratic',
    asks: 'A quadratic set equal to zero, asking for the greater or the lesser solution.',
    example: 'x^2 - 2x - 15 = 0. What is the lesser solution?',
    trap: 'Finding both roots and handing back the wrong one of the two.' },

  { id: 'adv-nleq-quad-sumproduct', skill: 'adv-nleq', ka: 'solving-quadratic-equations',
    label: 'Sum or product of the roots',
    asks: 'The two solutions combined, which can be read off the coefficients without solving.',
    example: 'x^2 - 9x + 20 = 0 has solutions p and q. What is pq ?',
    trap: 'Using -b/a where c/a was wanted, or reading a coefficient straight off with its printed sign.' },

  { id: 'adv-nleq-discriminant', skill: 'adv-nleq', ka: 'solving-quadratic-equations',
    label: 'Number of real solutions',
    asks: 'How many times the parabola crosses the x-axis, from the sign of b^2 - 4ac.',
    example: 'x^2 + 6x + 11 = 0. How many distinct real solutions does the equation have?',
    trap: 'Computing the discriminant correctly and then misreading zero as "no solutions".' },

  { id: 'adv-nleq-radical', skill: 'adv-nleq', ka: 'radical-rational-and-absolute-value-equations', oct: OCT.radicals,
    label: 'Solve a radical equation',
    asks: 'A square root containing x, equal to a number. Square both sides and finish.',
    example: 'sqrt(3x + 4) = 7. What is the solution?',
    trap: 'Subtracting the number instead of squaring it, or stopping at the squared value.' },

  { id: 'adv-nlfn-vertex', skill: 'adv-nlfn', ka: 'quadratic-graphs', oct: OCT.parabolas,
    label: 'Minimum or maximum of a parabola',
    asks: 'A quadratic in vertex form, asking for its least or greatest value.',
    example: 'f(x) = 2(x - 3)^2 - 11. What is the minimum value of f ?',
    trap: 'Reporting the x-coordinate of the vertex instead of the value there - giving 3 rather than -11.' },

  { id: 'adv-nlfn-exp-model', skill: 'adv-nlfn', ka: 'quadratic-and-exponential-word-problems', oct: OCT.exponentialFns,
    label: 'Read an exponential model',
    asks: 'An exponential function with a decimal base, asking which description of it is correct.',
    example: 'A(t) = 4200(0.86)^t. Which statement best describes the model?',
    trap: 'Reading the base 0.86 as a 86% decrease rather than a 14% one.' },

  { id: 'adv-nlfn-exp-evaluate', skill: 'adv-nlfn', ka: 'exponential-graphs', oct: OCT.exponentialFns,
    label: 'Evaluate an exponential function',
    asks: 'Substitute a small whole number into a growth function.',
    example: 'f(x) = 5(3)^x. What is the value of f(4) ?',
    trap: 'Multiplying the coefficient by the base by the exponent instead of raising to the power.' },

  { id: 'adv-nlfn-composite', skill: 'adv-nlfn', ka: 'nonlinear-functions', oct: OCT.functions,
    label: 'Composite functions',
    asks: 'Two functions given; evaluate one inside the other.',
    example: 'f(x) = 3x - 2 and g(x) = 2x + 5. What is the value of f(g(1)) ?',
    trap: 'Composing in the wrong order, or stopping after the inner function.' },

  /* ============================ Problem-Solving and Data Analysis */
  { id: 'psda-ratio-rate', skill: 'psda-ratio', ka: 'ratios-rates-and-proportions',
    label: 'Rates and proportions',
    asks: 'A rate stated for one quantity, scaled up or down to another.',
    example: 'A pump moves 84 litres every 4 seconds. How many litres in 60 seconds?',
    trap: 'Setting the proportion up upside down, so the answer comes out inverted.' },

  { id: 'psda-ratio-units', skill: 'psda-ratio', ka: 'unit-conversion', oct: OCT.units,
    label: 'Unit conversion',
    asks: 'A measurement restated in different units, with the conversion factor supplied.',
    example: 'A measurement is 7 kilograms. What is it in grams?',
    trap: 'Dividing where you should multiply - going the wrong way through the factor.' },

  { id: 'psda-pct-of', skill: 'psda-pct', ka: 'percentages',
    label: 'Percent of a number',
    asks: 'A straight percentage of a quantity.',
    example: 'What is 15% of 640 ?',
    trap: 'Misplacing the decimal, so the answer is out by a factor of ten.' },

  { id: 'psda-pct-change', skill: 'psda-pct', ka: 'percentages',
    label: 'One percent increase or decrease',
    asks: 'A quantity moved up or down by a percentage; the NEW amount is wanted.',
    example: 'A price of $480 is increased by 25%. What is the new price?',
    trap: 'Reporting the size of the change instead of the new total.' },

  { id: 'psda-pct-successive', skill: 'psda-pct', ka: 'percentages',
    label: 'Two percent changes in a row',
    asks: 'Up by one percentage, then down by another. The two do not cancel.',
    example: 'A quantity of 800 is increased by 25%, then decreased by 20%. What is the final quantity?',
    trap: 'Adding the percentages (+25 - 20 = +5%) instead of multiplying the two growth factors.' },

  { id: 'psda-pct-reverse', skill: 'psda-pct', ka: 'percentages',
    label: 'Work backwards from a percent change',
    asks: 'The amount AFTER a change is given; the amount before it is wanted.',
    example: 'After a 25% increase, a quantity is 500. What was it before?',
    trap: 'Taking 25% off the new value. Undoing a x1.25 means dividing by 1.25, not subtracting 25%.' },

  { id: 'psda-1var-center', skill: 'psda-1var', ka: 'center-spread-and-shape-of-distributions',
    label: 'Mean, median and range',
    asks: 'A short list of numbers and one named statistic to compute.',
    example: 'Data set: 4, 9, 12, 15, 27. What is the median of the data set?',
    trap: 'Computing a different statistic than the one named - the median when the mean was asked for.' },

  { id: 'psda-1var-spread', skill: 'psda-1var', ka: 'center-spread-and-shape-of-distributions',
    label: 'Effect of an outlier',
    asks: 'One far-out value added to a data set; what happens to the mean and the median.',
    example: 'A value of 300 is added to a set clustered near 30. What is the effect on the mean and median?',
    trap: 'Assuming both move together. The mean uses every value; the median only counts positions.' },

  { id: 'psda-2var-scatter', skill: 'psda-2var', ka: 'scatterplots',
    label: 'Predict from a line of best fit',
    asks: 'A fitted model given as an equation, used to predict at a stated input.',
    example: 'A line of best fit is y = 12x + 40. What does the model predict at x = 15 ?',
    trap: 'Dropping the intercept, or adding x to the intercept instead of multiplying by the slope.' },

  { id: 'psda-prob-table', skill: 'psda-prob', ka: 'probability-and-relative-frequency', oct: OCT.probTables,
    label: 'Probability from a two-way table',
    asks: 'A table of counts. Sometimes the whole table is the denominator; sometimes one row is.',
    example: 'Given the table, one Group A entry is chosen at random. What is the probability it is Passed?',
    trap: 'The whole question. A conditional probability uses the ROW total; using the grand total is the standard error.' },

  /* ============================== Geometry and Trigonometry */
  /* The two skills College Board lists under Problem-Solving and Data Analysis
     that this bank had no question types for at all. Their absence was reported
     by verify() on every single load - "skill psda-infer has no question types
     under it" - and it meant a student could sit a hundred practice tests here
     and never meet a margin-of-error question, which the real test asks. */
  { id: 'psda-infer-moe', skill: 'psda-infer', ka: 'data-inferences', oct: OCT.marginOfError,
    label: 'Margin of error',
    asks: 'A sample statistic is reported with a margin of error, and you have to say what range of values for the whole population it is consistent with.',
    example: 'A poll of 400 residents estimates mean commute time at 34 minutes with a margin of error of 3 minutes. Which is the most appropriate conclusion?',
    trap: 'Treating the interval as covering every individual rather than the population average, or thinking a larger sample widens the interval.' },

  { id: 'psda-claims-design', skill: 'psda-claims', ka: 'evaluating-statistical-claims', oct: OCT.statsOverview,
    label: 'Study design and what it licenses',
    asks: 'A study is described. You have to say what can be concluded from it, and to whom the conclusion applies.',
    example: 'Volunteers who already exercised were surveyed about sleep. What can be concluded?',
    trap: 'Reading cause into an observational study, or generalising past the group that was actually sampled.' },

  { id: 'geo-areavol-rect', skill: 'geo-areavol', ka: 'area-and-volume',
    label: 'Area of a rectangle',
    asks: 'Area and one side given, the other side wanted - the formula run backwards.',
    example: 'A rectangle has area 96 cm^2 and width 8 cm. What is its length?',
    trap: 'Subtracting the known side from the area instead of dividing.' },

  { id: 'geo-areavol-tri', skill: 'geo-areavol', ka: 'area-and-volume',
    label: 'Area of a triangle',
    asks: 'The one-half in the triangle formula, usually solved for a missing base or height.',
    example: 'A triangle has area 54 cm^2 and base 12 cm. What is its height?',
    trap: 'Forgetting the factor of one-half, which halves or doubles the answer.' },

  { id: 'geo-areavol-circle', skill: 'geo-areavol', ka: 'area-and-volume',
    label: 'Area of a circle',
    asks: 'Area from a radius or diameter.',
    example: 'A circle has a diameter of 14 cm. What is its area, in terms of pi ?',
    trap: 'Using the diameter where the formula wants the radius, which makes the answer four times too big.' },

  { id: 'geo-areavol-box', skill: 'geo-areavol', ka: 'area-and-volume', oct: OCT.geometry,
    label: 'Volume of a rectangular solid',
    asks: 'Three dimensions multiplied, or one recovered from the volume.',
    example: 'A box has volume 240 cm^3, length 8 cm and width 5 cm. What is its height?',
    trap: 'Using a surface-area formula, or adding the dimensions instead of multiplying.' },

  { id: 'geo-areavol-cyl', skill: 'geo-areavol', ka: 'area-and-volume', oct: OCT.geometry,
    label: 'Volume of a cylinder',
    asks: 'A circular base times a height.',
    example: 'A cylinder has radius 3 cm and height 10 cm. What is its volume, in terms of pi ?',
    trap: 'Forgetting to square the radius.' },

  { id: 'geo-lines-trianglesum', skill: 'geo-lines', ka: 'congruence-similarity-and-angle-relationships',
    label: 'Angles in a triangle',
    asks: 'The three interior angles add to 180.',
    example: 'Two angles of a triangle are 47 and 68 degrees. What is the third?',
    trap: 'Using 360 instead of 180.' },

  { id: 'geo-lines-parallel', skill: 'geo-lines', ka: 'congruence-similarity-and-angle-relationships',
    label: 'Parallel lines and a transversal',
    asks: 'Which angles are equal and which are supplementary when a line crosses two parallel lines.',
    example: 'Lines m and n are parallel. One angle is 118 degrees. What is the marked angle?',
    trap: 'Taking the equal angle when the supplementary one was marked, giving 62 for 118 or the reverse.' },

  { id: 'geo-lines-exterior', skill: 'geo-lines', ka: 'congruence-similarity-and-angle-relationships',
    label: 'Exterior angle of a triangle',
    asks: 'An exterior angle equals the sum of the two opposite interior angles.',
    example: 'A triangle has interior angles 40 and 75 degrees. What is the exterior angle at the third vertex?',
    trap: 'Subtracting from 180 twice, or using the adjacent interior angle instead of the two remote ones.' },

  { id: 'geo-lines-similar', skill: 'geo-lines', ka: 'congruence-similarity-and-angle-relationships', oct: OCT.similarity,
    label: 'Similar triangles',
    asks: 'Two triangles with equal angles; corresponding sides are in a fixed ratio.',
    example: 'Triangle ABC is similar to triangle DEF. AB = 6, DE = 9, BC = 8. What is EF ?',
    trap: 'Pairing sides that do not correspond, or adding the scale factor instead of multiplying by it.' },

  { id: 'geo-right-pythagorean', skill: 'geo-right', ka: 'right-triangle-trigonometry', oct: OCT.pythagorean,
    label: 'Pythagorean theorem',
    asks: 'A missing side of a right triangle from the other two.',
    example: 'A right triangle has legs 9 and 12. What is the length of the hypotenuse?',
    trap: 'Adding the squares when finding a leg, where you must subtract them.' },

  { id: 'geo-right-trig-ratio', skill: 'geo-right', ka: 'right-triangle-trigonometry', oct: OCT.trigonometry,
    label: 'Sine, cosine and tangent',
    asks: 'One trig ratio of an acute angle in a right triangle.',
    example: 'In a right triangle the side opposite angle A is 7 and the hypotenuse is 25. What is sin A ?',
    trap: 'Picking the wrong two sides - the classic sine-for-cosine swap.' },

  { id: 'geo-right-trig-complementary', skill: 'geo-right', ka: 'right-triangle-trigonometry', oct: OCT.trigonometry,
    label: 'Sine and cosine of complementary angles',
    asks: 'That sin x = cos(90 - x), used to convert between the two.',
    example: 'If sin x = 0.6, what is cos(90 - x) ?',
    trap: 'Assuming the two are opposites, or subtracting the value from 1 instead of the angle from 90.' },

  { id: 'geo-circle-equation', skill: 'geo-circle', ka: 'circle-equations',
    label: 'Equation of a circle',
    asks: 'Centre and radius read out of, or built into, (x - h)^2 + (y - k)^2 = r^2.',
    example: 'A circle has equation (x - 3)^2 + (y + 5)^2 = 49. What is its centre?',
    trap: 'Getting the signs of the centre backwards, and using r^2 where r was wanted.' },

  { id: 'geo-circle-arc', skill: 'geo-circle', ka: 'circle-theorems',
    label: 'Arc length',
    asks: 'A fraction of the circumference, set by the central angle.',
    example: 'A circle of radius 9 has a central angle of 80 degrees. What is the arc length?',
    trap: 'Using the area formula, or forgetting to scale by angle over 360.' },

  { id: 'geo-circle-sector', skill: 'geo-circle', ka: 'circle-theorems',
    label: 'Sector area',
    asks: 'A fraction of the area, set by the central angle.',
    example: 'A circle of radius 6 has a sector with central angle 120 degrees. What is the sector area?',
    trap: 'Confusing sector area with arc length - one uses r^2, the other r.' },

  { id: 'geo-circle-radians', skill: 'geo-circle', ka: 'unit-circle-trigonometry', oct: OCT.unitCircle,
    label: 'Degrees and radians',
    asks: 'Converting an angle between degrees and radians.',
    example: 'What is 135 degrees in radians?',
    trap: 'Multiplying by 180/pi when you needed pi/180.' },

  /* ================================== R&W: Information and Ideas */
  { id: 'rw-central-idea', skill: 'rw-central', ka: 'central-ideas-and-details',
    label: 'Main idea of a passage',
    asks: 'The one sentence that covers the whole text - not one true detail from inside it.',
    example: 'Which choice best states the main idea of the text?',
    trap: 'Choosing a statement that is true but too narrow, or one that overreaches beyond what the text says.' },

  { id: 'rw-evidence-textual', skill: 'rw-evidence-text', ka: 'command-of-evidence-textual',
    label: 'Which detail supports the claim',
    asks: 'A claim is stated; find the detail in the text that actually backs it up.',
    example: 'Which finding, if true, would most directly support the conclusion drawn by the researchers?',
    trap: 'Picking a choice that is on-topic and relevant but supports a slightly different claim.' },

  { id: 'rw-evidence-quantitative', skill: 'rw-evidence-quant', ka: 'command-of-evidence-quantitative',
    label: 'Which data supports the claim',
    asks: 'The same task, but the evidence is in a table or graph rather than the prose.',
    example: 'Which choice best describes data from the table that support the hypothesis?',
    trap: 'Choosing a statement that reads the graph correctly but does not bear on the claim being made.' },

  { id: 'rw-inference', skill: 'rw-infer', ka: 'inferences',
    label: 'Complete the inference',
    asks: 'Finish the text with the conclusion its own logic forces - one step beyond what is written, no more.',
    example: 'Which choice most logically completes the text?',
    trap: 'Taking two steps instead of one, or importing outside knowledge the passage never offered.' },

  /* ==================================== R&W: Craft and Structure */
  { id: 'rw-words-in-context', skill: 'rw-words', ka: 'words-in-context',
    label: 'Word in context',
    asks: 'Which word fits the blank, decided by the sentence around it rather than by the dictionary.',
    example: 'Which choice completes the text with the most logical and precise word?',
    trap: 'Choosing a word that shares a general sense but the wrong register or connotation for this sentence.' },

  { id: 'rw-text-structure', skill: 'rw-structure', ka: 'text-structure-and-purpose',
    label: 'Structure or purpose of a text',
    asks: 'What the text is DOING - how it is built, or why a sentence is where it is.',
    example: 'Which choice best describes the overall structure of the text?',
    trap: 'Describing what the text is about instead of how it is organised.' },

  { id: 'rw-cross-text', skill: 'rw-crosstext', ka: 'cross-text-connections',
    label: 'Comparing two texts',
    asks: 'Two passages on one topic; how the second author would respond to the first.',
    example: 'Based on the texts, how would the author of Text 2 most likely respond to Text 1 ?',
    trap: 'Assuming the two authors must disagree. Sometimes one qualifies or extends the other.' },

  /* ==================================== R&W: Expression of Ideas */
  { id: 'rw-rhetorical-synthesis', skill: 'rw-synthesis', ka: 'rhetorical-synthesis',
    label: 'Use the notes to meet a goal',
    asks: 'Bullet-point notes plus a stated goal; pick the sentence that achieves THAT goal.',
    example: 'Which choice most effectively uses the notes to emphasise the scale of the study?',
    trap: 'Choosing an accurate sentence that serves a different goal than the one specified.' },

  { id: 'rw-transition', skill: 'rw-transitions', ka: 'transitions',
    label: 'Transition word or phrase',
    asks: 'The logical relationship between two sentences: contrast, cause, addition, example, sequence.',
    example: 'Which transition best fits the blank between the two sentences?',
    trap: 'Reaching for "however" by default. Read whether the second sentence opposes the first or extends it.' },

  /* ============================ R&W: Standard English Conventions */
  { id: 'rw-boundaries-sentence', skill: 'rw-boundaries', ka: 'boundaries-punctuation',
    label: 'Joining two complete sentences',
    asks: 'Two full sentences pushed together; choose punctuation that legally separates or joins them.',
    example: 'Glassblowing requires constant rotation of the pipe ___ gravity would otherwise pull the form out of true.',
    trap: 'The comma splice. A comma alone cannot join two independent clauses; it needs a conjunction or a stronger mark.' },

  { id: 'rw-boundaries-supplement', skill: 'rw-boundaries', ka: 'boundaries-supplements',
    label: 'Punctuating a supplement',
    asks: 'An extra descriptive phrase dropped into a sentence, needing matched punctuation on both sides.',
    example: 'The lead researcher ___ a specialist in deep-sea ecology ___ published the findings.',
    trap: 'Opening with a comma and closing with a dash. Whatever mark starts the interruption must finish it.' },

  { id: 'rw-fss-subject-verb', skill: 'rw-fss', ka: 'fss-sva',
    label: 'Subject-verb agreement',
    asks: 'Whether the verb matches its subject in number, with words in between to distract you.',
    example: 'The collection of manuscripts held in the archive ___ rarely displayed.',
    trap: 'Agreeing with the nearest noun ("manuscripts") rather than the real subject ("collection").' },

  { id: 'rw-fss-pronoun', skill: 'rw-fss', ka: 'fss-pronoun-antecedent-agreement',
    label: 'Pronoun-antecedent agreement',
    asks: 'Whether a pronoun matches the thing it refers back to in number.',
    example: 'Each of the laboratories maintains ___ own calibration records.',
    trap: 'Missing that "each" is singular even though the phrase after it is plural.' },

  { id: 'rw-fss-genitive', skill: 'rw-fss', ka: 'fss-plurals-and-possessives',
    label: 'Plurals and possessives',
    asks: 'Choosing between plural, singular possessive and plural possessive, and between ' +
          'possessive determiners and contractions (its and it is, their and they are, there).',
    example: 'The ___ findings were published in three separate journals.',
    trap: 'Apostrophe placement. A possessive marked on the plural and one marked on the singular ' +
          'say different things, and only one of them fits the sentence.' },

  { id: 'rw-fss-modifier', skill: 'rw-fss', ka: 'fss-subject-modifier-placement',
    label: 'Modifier placement',
    asks: 'A descriptive opening phrase must attach to the right noun - the one immediately after it.',
    example: 'Having sequenced the genome, ___ identified the mutation.',
    trap: 'Leaving the modifier dangling, so the sentence claims the wrong thing performed the action.' },

  { id: 'rw-fss-verb-tense', skill: 'rw-fss', ka: 'fss-verb-forms',
    label: 'Verb tense and aspect',
    asks: 'Which tense the surrounding sentences establish, and staying consistent with it.',
    example: 'By the time the survey concluded, the population ___ by nearly half.',
    trap: 'Ignoring a time marker such as "by the time", which forces a completed past rather than a simple one.' }
];

/* ------------------------------------------------------------------ indexes */

const SKILL_BY_ID = {};
for (const s of SKILLS) SKILL_BY_ID[s.id] = s;

const QTYPE_BY_ID = {};
for (const q of QTYPES) QTYPE_BY_ID[q.id] = q;

/* Question types grouped under their skill, in declaration order - which is
   the order the printed report walks them in. */
const QTYPES_BY_SKILL = {};
for (const q of QTYPES) {
  (QTYPES_BY_SKILL[q.skill] || (QTYPES_BY_SKILL[q.skill] = [])).push(q);
}

const SKILLS_BY_DOMAIN = {};
for (const s of SKILLS) {
  (SKILLS_BY_DOMAIN[s.domain] || (SKILLS_BY_DOMAIN[s.domain] = [])).push(s);
}

const DOMAIN_SECTION = {
  [D_ALG]: SEC_MATH, [D_ADV]: SEC_MATH, [D_PSDA]: SEC_MATH, [D_GEO]: SEC_MATH,
  [D_CRAFT]: SEC_RW, [D_INFO]: SEC_RW, [D_CONV]: SEC_RW, [D_EXPR]: SEC_RW
};

/* ------------------------------------------------------------------- cues

   How you know, from the question alone, that this is the type in front of you.

   `asks` says what the task is and `trap` says how it is failed. Neither helps
   at the moment that actually decides the question, which is the first four
   seconds: recognising which of sixty-five things you are looking at. That is
   the one skill a bank of practice questions teaches by accident and never
   states, and it is what Khan's own lessons open with - "when you see X, they
   are asking you to Y".

   Kept as a separate table rather than a sixth field on every entry above, so
   the shape of a question type stays readable, and so a missing cue is one
   lookup rather than a scan of a thousand lines. verify() requires every type
   to have one. */
const CUES = {
  'alg-lin1-solve': 'A single equation with x on both sides and no story around it.',
  'alg-lin1-count': 'A letter sits where a coefficient should be, and the question asks HOW MANY solutions rather than what they are.',
  'alg-lin2-write': 'You are given points, a slope, or a parallel/perpendicular line, and asked for an equation rather than a number.',
  'alg-linfn-evaluate': 'A function is defined in words or symbols and you are handed one specific input to put into it.',
  'alg-linfn-interpret': 'The answer choices are SENTENCES about what a number means, not numbers.',
  'alg-sys-solve': 'Two equations stacked, two unknowns, and the question wants a value.',
  'alg-sys-count': 'Two equations stacked, but the question asks how many solutions the system has.',
  'alg-ineq-solve': 'An inequality sign, plus the words "least" or "greatest" and "integer".',
  'adv-equiv-diffsquares': 'Two perfect squares with a minus between them, and no middle term.',
  'adv-equiv-expand': 'Two brackets side by side, asking which expression is equivalent.',
  'adv-equiv-factor': 'A quadratic in standard form, asking for it in brackets.',
  'adv-equiv-exponent-product': 'Two powers of the same base multiplied together.',
  'adv-equiv-exponent-power': 'A bracket with a power inside AND a power outside it.',
  'adv-equiv-exponent-quotient': 'One power divided by another power of the same base.',
  'adv-equiv-exponent-negative': 'A minus sign in the EXPONENT rather than in front of the term.',
  'adv-nleq-quad-roots': 'A quadratic set to zero, asking for a specific root - often "the greater" or "the lesser".',
  'adv-nleq-quad-sumproduct': 'The question asks for the sum or the product of the solutions without asking what they are.',
  'adv-nleq-discriminant': 'A quadratic, and the question is HOW MANY real solutions - never what they are.',
  'adv-nleq-radical': 'A square-root sign wrapped around an expression containing x.',
  'adv-nlfn-vertex': 'A quadratic written as a(x - h)² + k, asking for a minimum or maximum VALUE.',
  'adv-nlfn-exp-model': 'A function of the form A(bᵗ) with answer choices that are sentences about growth or decay.',
  'adv-nlfn-exp-evaluate': 'A function of the form A(bᵗ) with a specific t to substitute.',
  'adv-nlfn-composite': 'Two functions and a nested notation such as f(g(3)).',
  'psda-ratio-rate': 'A rate given for one quantity and a different quantity asked about - "if 3 cost 12, what do 7 cost".',
  'psda-ratio-units': 'A conversion factor is handed to you in the question itself, usually in brackets.',
  'psda-pct-of': 'The bare shape "what is P% of N".',
  'psda-pct-change': 'One price or quantity, changed once, asking for the new value.',
  'psda-pct-successive': 'TWO percentage changes applied one after the other.',
  'psda-pct-reverse': 'The result is given and the ORIGINAL is asked for - the word "after" is usually the giveaway.',
  'psda-1var-center': 'A list of numbers and the word mean, median or mode.',
  'psda-1var-spread': 'A value is added to or removed from a set, and the choices talk about what happens to two statistics at once.',
  'psda-2var-scatter': 'A line of best fit is given as an equation and you are asked to PREDICT.',
  'psda-prob-table': 'A two-way table, and the question names a row or a column before asking for a probability.',
  'psda-infer-moe': 'The phrase "margin of error" appears, and the choices are sentences about a range.',
  'psda-claims-design': 'A study is described in a paragraph and the choices are all conclusions - the question is what the DESIGN allows, not what the numbers say.',
  'geo-areavol-rect': 'A rectangle with the area given and a side asked for, or the reverse.',
  'geo-areavol-tri': 'Base and height are named explicitly - that pairing is the signal for the ½.',
  'geo-areavol-circle': 'A radius and the phrase "in terms of π".',
  'geo-areavol-box': 'Three dimensions, or a volume and two of the three.',
  'geo-areavol-cyl': 'The words "right circular cylinder", with a radius and a height.',
  'geo-lines-trianglesum': 'Two angles of a triangle given, the third asked for.',
  'geo-lines-parallel': 'The words "parallel" and "transversal" together.',
  'geo-lines-exterior': 'The word EXTERIOR - the whole question turns on it.',
  'geo-lines-similar': 'Two triangles described as similar, with sides given in both.',
  'geo-right-pythagorean': 'A right angle and two sides, with the third asked for and no mention of sin, cos or tan.',
  'geo-right-trig-ratio': 'sin, cos or tan appears with an angle name, in a triangle whose sides are all given.',
  'geo-right-trig-complementary': 'Two different angles in the same right triangle, linked by sin of one and cos of the other.',
  'geo-circle-equation': 'x² and y² both present with no xy term, or a centre and radius handed to you.',
  'geo-circle-arc': 'A central angle in degrees and the word ARC or LENGTH.',
  'geo-circle-sector': 'A central angle in degrees and the word SECTOR or AREA.',
  'geo-circle-radians': 'π appears in an angle measure, or the question names both degrees and radians.',
  'rw-central-idea': 'The stem says "main idea", "main purpose" or "best states" and points at the whole text.',
  'rw-evidence-textual': 'The stem describes a claim or hypothesis and asks which finding would SUPPORT or WEAKEN it.',
  'rw-evidence-quantitative': 'There is a table or graph, and the answer choices are statements about the data.',
  'rw-inference': 'The passage ends with a blank, or the stem says "most logically completes" or "logically follows".',
  'rw-words-in-context': 'A blank inside a sentence with four single words or short phrases as choices.',
  'rw-text-structure': 'The stem asks about the FUNCTION of a marked sentence, not what it says.',
  'rw-cross-text': 'Two passages labelled Text 1 and Text 2, and the stem asks how one author would respond to the other.',
  'rw-rhetorical-synthesis': 'Bulleted student notes, and the stem states a GOAL the sentence has to accomplish.',
  'rw-transition': 'A blank at the start of a sentence with connecting words as the choices - however, therefore, for example.',
  'rw-boundaries-sentence': 'The answer choices differ only in the punctuation between two complete ideas.',
  'rw-boundaries-supplement': 'A descriptive phrase sits in the middle of a sentence and the choices vary its commas or dashes.',
  'rw-fss-subject-verb': 'The choices are all the same verb in different forms, with a phrase separating it from its subject.',
  'rw-fss-pronoun': 'The choices are pronouns - its, their, it, they.',
  'rw-fss-genitive': 'The choices differ only in where an apostrophe sits, or whether there is one.',
  'rw-fss-modifier': 'The sentence opens with a descriptive phrase and a comma, and the choices are whole clauses.',
  'rw-fss-verb-tense': 'The choices are one verb in several tenses, and the sentence names a time.'
};

/* Attached to the entries themselves so every consumer - the logbook, the
   analysis card, the print document - reads it the same way the other five
   fields are read, with no second lookup to remember. */
for (const q of QTYPES) q.cue = CUES[q.id] || null;

/* -------------------------------------------------------------- accessors */

function qtype(id) { return QTYPE_BY_ID[id] || null; }
function skill(id) { return SKILL_BY_ID[id] || null; }

/* The skill a question type belongs to, or null. */
function skillOf(qtypeId) {
  const q = QTYPE_BY_ID[qtypeId];
  return q ? SKILL_BY_ID[q.skill] || null : null;
}

function domainOf(qtypeId) {
  const s = skillOf(qtypeId);
  return s ? s.domain : null;
}

function sectionOf(qtypeId) {
  const s = skillOf(qtypeId);
  return s ? s.section : null;
}

/* Display name for a question type that has no taxonomy entry. An unknown id
   is a bug, but it must still render as something a human can read rather than
   as a blank row. */
function labelOf(qtypeId) {
  const q = QTYPE_BY_ID[qtypeId];
  if (q) return q.label;
  return String(qtypeId || 'unknown')
    .replace(/^[a-z]+-/, '').replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Study links for a question type, with the fallback chain described at the
   top of this file. Always returns an object; `video` may be null but `page`
   never is, because the domain unit page always exists.

   `origin` says which level actually supplied each link, so a screen can be
   honest about specificity instead of implying a general link is a specific
   one. */
function resources(qtypeId) {
  const q = QTYPE_BY_ID[qtypeId];
  const s = q ? SKILL_BY_ID[q.skill] : null;
  const domain = s ? s.domain : null;
  const unit = domain
    ? (DOMAIN_SECTION[domain] === SEC_MATH ? UNIT[domain] : RW_UNIT[domain])
    : RW_COURSE;

  /* Resolve the Khan lesson from the question type, falling back to the parent
     skill's lesson, then to the domain unit. Each step is a real page, so there
     is no path through here that returns a dead link - and `origin` records
     which level actually answered, so a screen can say "this is the lesson for
     the whole skill" rather than implying a general link is a specific one. */
  let links = null, origin = null;
  if (q && q.ka) { links = lessonLinks(q.ka); origin = 'qtype'; }
  if (!links && s && s.ka) { links = lessonLinks(s.ka); origin = 'skill'; }
  if (!links) { links = { page: unit, video: null, practice: null }; origin = 'unit'; }

  return {
    page: links.page || unit,
    video: links.video || null,
    practice: links.practice || null,
    /* Both slots report the same origin because they come from the same lesson;
       kept as two fields so a caller does not have to know that. */
    pageOrigin: links.page ? origin : 'unit',
    videoOrigin: links.video ? origin : null,

    /* The long-form Organic Chemistry Tutor video. Taken from the question type
       when it has its own - a skill like "Equivalent expressions" spans
       factoring AND exponent rules, and one video cannot cover both - otherwise
       from the parent skill. Null throughout Reading and Writing, which he does
       not cover; inventing a stand-in there would be worse than showing
       nothing. */
    oct: octLink((q && q.oct) || (s && s.oct) || null),

    skillName: s ? s.cb : null,
    lesson: (q && q.ka) || (s && s.ka) || null,
    unit
  };
}

/* Is there enough data to make a claim about this row? */
function enoughData(total) { return (total | 0) >= MIN_CLAIM; }

/* ------------------------------------------------------------------ verify

   Two failure modes this guards against, both of which have already happened
   once in this project at the domain level:

     - a generator stamps a qtype that does not exist here, so the analysis
       shows a row with no description and no links
     - a qtype exists here but nothing generates it, so the report promises
       coverage the game does not have

   Neither is visible by reading the code, because the two lists live in
   different files. So they are compared at load, out loud. */
function verify(generatedIds) {
  const problems = [];

  for (const q of QTYPES) {
    if (!SKILL_BY_ID[q.skill]) {
      problems.push('qtype ' + q.id + ' names skill ' + q.skill + ', which is not defined');
    }
    if (!q.label || !q.asks || !q.example || !q.trap) {
      problems.push('qtype ' + q.id + ' is missing one of label/asks/example/trap');
    }
    /* Checked separately from the four above because cues live in their own
       table: a type added to QTYPES without a matching CUES entry is exactly
       the mistake the split invites, so it is the one this names out loud. */
    if (!q.cue) problems.push('qtype ' + q.id + ' has no recognition cue');
  }
  for (const s of SKILLS) {
    if (!DOMAIN_SECTION[s.domain]) {
      problems.push('skill ' + s.id + ' names domain "' + s.domain + '", which is not a known domain');
    }
    if (DOMAIN_SECTION[s.domain] !== s.section) {
      problems.push('skill ' + s.id + ' claims section ' + s.section +
                    ' but domain "' + s.domain + '" belongs to ' + DOMAIN_SECTION[s.domain]);
    }
    if (!QTYPES_BY_SKILL[s.id]) {
      problems.push('skill ' + s.id + ' has no question types under it');
    }
  }

  /* Every question type must resolve to a page link. This is the check that
     makes the "no dead links" claim at the top of the file testable rather
     than aspirational. */
  for (const q of QTYPES) {
    const r = resources(q.id);
    if (!r.page) problems.push('qtype ' + q.id + ' resolves to no page link');
  }

  /* A misspelled lesson key does not throw - it silently falls back to the
     domain unit, so the student gets a link that works but is far more general
     than the one intended, and nothing anywhere says so. That is the failure
     this catches: every declared `ka` must actually name a lesson. */
  for (const q of QTYPES) {
    if (q.ka && !lessonLinks(q.ka)) {
      problems.push('qtype ' + q.id + ' names Khan lesson "' + q.ka + '", which is not in either lesson table');
    }
  }
  for (const s of SKILLS) {
    if (s.ka && !lessonLinks(s.ka)) {
      problems.push('skill ' + s.id + ' names Khan lesson "' + s.ka + '", which is not in either lesson table');
    }
  }

  /* Every question type should reach a video, since "Helpful Video" is a
     promised part of the report. Reported rather than fatal: a type whose
     lesson genuinely has no video should still work. */
  const noVideo = QTYPES.filter((q) => !resources(q.id).video).map((q) => q.id);
  if (noVideo.length) {
    problems.push(noVideo.length + ' qtype(s) resolve to no video: ' + noVideo.join(', '));
  }

  /* Math question types must reach an Organic Chemistry Tutor video; Reading
     and Writing ones must NOT, because he does not cover it and a link there
     would be a fabrication. Both directions are checked. */
  for (const q of QTYPES) {
    const sec = sectionOf(q.id);
    const hasOct = !!resources(q.id).oct;
    if (sec === SEC_MATH && !hasOct) {
      problems.push('math qtype ' + q.id + ' has no Organic Chemistry Tutor video');
    }
    if (sec === SEC_RW && hasOct) {
      problems.push('R&W qtype ' + q.id + ' has an Organic Chemistry Tutor video, which cannot be right');
    }
  }

  if (generatedIds) {
    for (const id of generatedIds) {
      if (!QTYPE_BY_ID[id]) problems.push('generated qtype "' + id + '" is not in the taxonomy');
    }
    const seen = new Set(generatedIds);
    for (const q of QTYPES) {
      if (!seen.has(q.id)) problems.push('taxonomy qtype "' + q.id + '" is never generated');
    }
  }

  if (problems.length) {
    console.warn('[taxonomy] ' + problems.length + ' problem(s):\n  ' + problems.join('\n  '));
  }
  return problems;
}

SATG.taxonomy = {
  MIN_CLAIM,
  SKILLS, QTYPES,
  SKILL_BY_ID, QTYPE_BY_ID, QTYPES_BY_SKILL, SKILLS_BY_DOMAIN, DOMAIN_SECTION,
  UNIT, RW_UNIT, RW_COURSE,
  qtype, skill, skillOf, domainOf, sectionOf, labelOf, resources,
  lessonLinks, octLink, M_LESSON, R_LESSON, OCT,
  enoughData, verify,
  domains: { D_ALG, D_ADV, D_PSDA, D_GEO, D_CRAFT, D_INFO, D_CONV, D_EXPR }
};

/* Self-check that does not need the generators: structural problems inside
   this file are reported the moment it loads. The generator cross-check runs
   later, from the question banks, once they exist. */
verify(null);

})(window);
