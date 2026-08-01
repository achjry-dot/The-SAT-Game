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

/* Course unit pages, read from the href attributes on Khan's SAT course pages.
   These are the terminal fallback: every question type can reach one. */
const H = 'x0fcc98a58ba3bea7';
const UNIT = {
  [D_ALG]:  KA + '/test-prep/v2-sat-math/' + H + ':algebra-medium',
  [D_ADV]:  KA + '/test-prep/v2-sat-math/' + H + ':advanced-math-medium',
  [D_PSDA]: KA + '/test-prep/v2-sat-math/' + H + ':problem-solving-and-data-analysis-medium',
  [D_GEO]:  KA + '/test-prep/v2-sat-math/' + H + ':geometry-and-trigonometry-medium'
};

/* The Reading and Writing course root. R&W unit hrefs live on that course's
   own page and are filled in the same way; until each is read from the DOM the
   course root is used, which is a real page. */
const RW_COURSE = KA + '/test-prep/v2-sat-reading';
const RW_UNIT = {
  [D_CRAFT]: RW_COURSE,
  [D_INFO]:  RW_COURSE,
  [D_CONV]:  RW_COURSE,
  [D_EXPR]:  RW_COURSE
};

/* Math lesson exercises, each href read verbatim from the course page DOM.
   Keyed by Khan's own lesson slug so the mapping below reads as a mapping
   rather than a pile of URLs. */
const L = {};
(function lessons() {
  const base = KA + '/test-prep/v2-sat-math/' + H + ':';
  const add = (unit, slug, tier) => {
    L[slug] = base + unit + '-' + tier + '/' + H + ':' + slug + '-' + tier +
              '/e/v2-' + slug + '-1';
  };
  /* Only slugs whose full href was observed on the rendered page are listed.
     Adding a slug here that was not observed would be exactly the pattern-
     assembled URL this file refuses to ship. */
  add('algebra', 'solving-linear-equations-and-inequalities', 'easier');
  add('algebra', 'linear-equation-word-problems', 'easier');
  add('algebra', 'linear-relationship-word-problems', 'easier');
  add('algebra', 'graphs-of-linear-equations-and-functions', 'easier');
  add('algebra', 'solving-systems-of-linear-equations', 'easier');
  add('algebra', 'systems-of-linear-equations-word-problems', 'easier');
  add('algebra', 'linear-inequality-word-problems', 'easier');
  add('algebra', 'graphs-of-linear-systems-and-inequalities', 'easier');
  add('problem-solving-and-data-analysis', 'ratios-rates-and-proportions', 'easier');
  add('problem-solving-and-data-analysis', 'unit-conversion', 'easier');
  add('problem-solving-and-data-analysis', 'percentages', 'easier');
  add('problem-solving-and-data-analysis', 'center-spread-and-shape-of-distributions', 'easier');
  add('problem-solving-and-data-analysis', 'data-representations', 'easier');
  add('problem-solving-and-data-analysis', 'scatterplots', 'easier');
  add('problem-solving-and-data-analysis', 'linear-and-exponential-growth', 'easier');
})();

/* ------------------------------------------------------------------- skills */

/* `cb` is College Board's published name for the testing point, verbatim.
   `oct` is the long-form Organic Chemistry Tutor video for the whole skill -
   attached here rather than to a question type because his videos cover a
   broad topic, which is the level a skill sits at. */
const SKILLS = [
  /* ---- Math: Algebra */
  { id: 'alg-lin1', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear equations in one variable',
    page: L['solving-linear-equations-and-inequalities'] },
  { id: 'alg-lin2', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear equations in two variables',
    page: L['graphs-of-linear-equations-and-functions'] },
  { id: 'alg-linfn', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear functions',
    page: L['linear-relationship-word-problems'] },
  { id: 'alg-sys', section: SEC_MATH, domain: D_ALG,
    cb: 'Systems of two linear equations in two variables',
    page: L['solving-systems-of-linear-equations'] },
  { id: 'alg-ineq', section: SEC_MATH, domain: D_ALG,
    cb: 'Linear inequalities in one or two variables',
    page: L['linear-inequality-word-problems'] },

  /* ---- Math: Advanced Math */
  { id: 'adv-equiv', section: SEC_MATH, domain: D_ADV,
    cb: 'Equivalent expressions' },
  { id: 'adv-nleq', section: SEC_MATH, domain: D_ADV,
    cb: 'Nonlinear equations in one variable and systems of equations in two variables' },
  { id: 'adv-nlfn', section: SEC_MATH, domain: D_ADV,
    cb: 'Nonlinear functions' },

  /* ---- Math: Problem-Solving and Data Analysis */
  { id: 'psda-ratio', section: SEC_MATH, domain: D_PSDA,
    cb: 'Ratios, rates, proportional relationships, and units',
    page: L['ratios-rates-and-proportions'] },
  { id: 'psda-pct', section: SEC_MATH, domain: D_PSDA,
    cb: 'Percentages',
    page: L['percentages'] },
  { id: 'psda-1var', section: SEC_MATH, domain: D_PSDA,
    cb: 'One-variable data: distributions and measures of center and spread',
    page: L['center-spread-and-shape-of-distributions'] },
  { id: 'psda-2var', section: SEC_MATH, domain: D_PSDA,
    cb: 'Two-variable data: models and scatterplots',
    page: L['scatterplots'] },
  { id: 'psda-prob', section: SEC_MATH, domain: D_PSDA,
    cb: 'Probability and conditional probability' },
  { id: 'psda-infer', section: SEC_MATH, domain: D_PSDA,
    cb: 'Inference from sample statistics and margin of error' },
  { id: 'psda-claims', section: SEC_MATH, domain: D_PSDA,
    cb: 'Evaluating statistical claims: observational studies and experiments' },

  /* ---- Math: Geometry and Trigonometry */
  { id: 'geo-areavol', section: SEC_MATH, domain: D_GEO,
    cb: 'Area and volume' },
  { id: 'geo-lines', section: SEC_MATH, domain: D_GEO,
    cb: 'Lines, angles, and triangles' },
  { id: 'geo-right', section: SEC_MATH, domain: D_GEO,
    cb: 'Right triangles and trigonometry' },
  { id: 'geo-circle', section: SEC_MATH, domain: D_GEO,
    cb: 'Circles' },

  /* ---- R&W: Information and Ideas */
  { id: 'rw-central', section: SEC_RW, domain: D_INFO,
    cb: 'Central Ideas and Details' },
  { id: 'rw-evidence-text', section: SEC_RW, domain: D_INFO,
    cb: 'Command of Evidence: Textual' },
  { id: 'rw-evidence-quant', section: SEC_RW, domain: D_INFO,
    cb: 'Command of Evidence: Quantitative' },
  { id: 'rw-infer', section: SEC_RW, domain: D_INFO,
    cb: 'Inferences' },

  /* ---- R&W: Craft and Structure */
  { id: 'rw-words', section: SEC_RW, domain: D_CRAFT,
    cb: 'Words in Context' },
  { id: 'rw-structure', section: SEC_RW, domain: D_CRAFT,
    cb: 'Text Structure and Purpose' },
  { id: 'rw-crosstext', section: SEC_RW, domain: D_CRAFT,
    cb: 'Cross-Text Connections' },

  /* ---- R&W: Expression of Ideas */
  { id: 'rw-synthesis', section: SEC_RW, domain: D_EXPR,
    cb: 'Rhetorical Synthesis' },
  { id: 'rw-transitions', section: SEC_RW, domain: D_EXPR,
    cb: 'Transitions' },

  /* ---- R&W: Standard English Conventions.
     College Board splits this domain into two skills, each with named
     sub-points; those sub-points are the question types below. This is the
     part the old code collapsed hardest: five different generators all
     reported themselves as "form-structure-sense". */
  { id: 'rw-boundaries', section: SEC_RW, domain: D_CONV,
    cb: 'Boundaries' },
  { id: 'rw-fss', section: SEC_RW, domain: D_CONV,
    cb: 'Form, Structure, and Sense' }
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
  { id: 'alg-lin1-solve', skill: 'alg-lin1',
    label: 'Solve a linear equation',
    asks: 'One equation, one unknown, no context. Collect the x terms on one side and the numbers on the other.',
    example: '7x - 4 = 3x + 16.  What is the value of x ?',
    trap: 'Losing a sign when moving a term across, or reporting the value of the expression instead of x.' },

  { id: 'alg-lin1-count', skill: 'alg-lin1',
    label: 'No solution or infinitely many',
    asks: 'A linear equation with a letter in place of a coefficient, asking when it has no solution, one, or infinitely many.',
    example: 'For what value of a does 4x + 9 = ax + 9 have infinitely many solutions?',
    trap: 'Treating "no solution" and "infinitely many" as the same case. They differ only in the constants.' },

  { id: 'alg-lin2-write', skill: 'alg-lin2',
    label: 'Write the equation of a line',
    asks: 'Given two points, or a point and a slope, or a parallel or perpendicular line, produce the equation.',
    example: 'Line k passes through (2, -3) and is perpendicular to y = 4x + 1. What is the equation of k ?',
    trap: 'Using the slope as given for a perpendicular line instead of the negative reciprocal.' },

  { id: 'alg-linfn-evaluate', skill: 'alg-linfn',
    label: 'Evaluate a linear model',
    asks: 'A linear function models a real quantity. Substitute the given input and report the output.',
    example: 'V(t) = -18t + 900 models litres remaining after t minutes. What is V(12) ?',
    trap: 'Dropping the starting value and reporting only the rate times the time.' },

  { id: 'alg-linfn-interpret', skill: 'alg-linfn',
    label: 'Interpret slope and intercept',
    asks: 'No arithmetic at all. Say what one of the two numbers in the model MEANS in the situation described.',
    example: 'In V(t) = -18t + 900, which statement best interprets the -18 ?',
    trap: 'Swapping the two roles: describing the intercept when asked about the rate, or reading a decrease as an increase.' },

  { id: 'alg-sys-solve', skill: 'alg-sys',
    label: 'Solve a system of two equations',
    asks: 'Two linear equations in x and y. Solve for one variable, or for a combination such as x + y.',
    example: '3x + 2y = 19,  5x - 2y = 5.  What is the value of x + y ?',
    trap: 'Solving correctly and then answering the wrong question - giving x when x + y was asked for.' },

  { id: 'alg-sys-count', skill: 'alg-sys',
    label: 'How many solutions a system has',
    asks: 'Whether two lines meet once, never, or everywhere - decided by comparing coefficients, not by solving.',
    example: '2x + 3y = 7,  6x + 9y = 14.  How many solutions does the system have?',
    trap: 'Answering "exactly two", carried over from quadratics. Two lines can never meet twice.' },

  { id: 'alg-ineq-solve', skill: 'alg-ineq',
    label: 'Solve a linear inequality',
    asks: 'Isolate x in an inequality, then give the least or greatest integer that satisfies it.',
    example: '5x - 3 <= 27.  What is the greatest integer value of x that satisfies the inequality?',
    trap: 'Rounding the wrong way at the boundary, or forgetting to flip the sign when dividing by a negative.' },

  /* ============================================ Advanced Math */
  { id: 'adv-equiv-diffsquares', skill: 'adv-equiv',
    label: 'Difference of two squares',
    asks: 'Recognise a squared term minus a squared term and split it into two brackets.',
    example: 'Which expression is equivalent to 16x^2 - 49 ?',
    trap: 'Treating it as a perfect square, giving (4x - 7)^2 instead of (4x - 7)(4x + 7).' },

  { id: 'adv-equiv-expand', skill: 'adv-equiv',
    label: 'Multiply two binomials',
    asks: 'Expand two brackets into a trinomial.',
    example: 'Which expression is equivalent to (x + 5)(x - 3) ?',
    trap: 'Losing the cross terms, so x^2 - 15 is offered instead of x^2 + 2x - 15.' },

  { id: 'adv-equiv-factor', skill: 'adv-equiv',
    label: 'Factor a trinomial',
    asks: 'Run the expansion backwards: find two numbers with the right product and the right sum.',
    example: 'Which expression is equivalent to x^2 - 7x + 12 ?',
    trap: 'Getting the pair right and both signs wrong, giving (x + 3)(x + 4).' },

  { id: 'adv-equiv-exponent-product', skill: 'adv-equiv',
    label: 'Multiplying powers',
    asks: 'Powers of the same base multiplied together.',
    example: 'Which expression is equivalent to (5x^3)(x^4) ?',
    trap: 'Multiplying the exponents instead of adding them.' },

  { id: 'adv-equiv-exponent-power', skill: 'adv-equiv',
    label: 'A power raised to a power',
    asks: 'A whole bracket, coefficient included, raised to an exponent.',
    example: 'Which expression is equivalent to (3x^2)^4 ?',
    trap: 'Raising only the variable and leaving the coefficient alone.' },

  { id: 'adv-equiv-exponent-quotient', skill: 'adv-equiv',
    label: 'Dividing powers',
    asks: 'Powers of the same base divided.',
    example: 'Which expression is equivalent to (x^9)/(x^4) ?',
    trap: 'Adding the exponents, or dividing them.' },

  { id: 'adv-equiv-exponent-negative', skill: 'adv-equiv',
    label: 'Negative exponents',
    asks: 'What a negative exponent does, and what it leaves alone.',
    example: 'Which expression is equivalent to 6x^(-3) ?',
    trap: 'Dragging the coefficient into the denominator too, or turning the negative exponent into a minus sign.' },

  { id: 'adv-nleq-quad-roots', skill: 'adv-nleq',
    label: 'Solve a quadratic',
    asks: 'A quadratic set equal to zero, asking for the greater or the lesser solution.',
    example: 'x^2 - 2x - 15 = 0. What is the lesser solution?',
    trap: 'Finding both roots and handing back the wrong one of the two.' },

  { id: 'adv-nleq-quad-sumproduct', skill: 'adv-nleq',
    label: 'Sum or product of the roots',
    asks: 'The two solutions combined, which can be read off the coefficients without solving.',
    example: 'x^2 - 9x + 20 = 0 has solutions p and q. What is pq ?',
    trap: 'Using -b/a where c/a was wanted, or reading a coefficient straight off with its printed sign.' },

  { id: 'adv-nleq-discriminant', skill: 'adv-nleq',
    label: 'Number of real solutions',
    asks: 'How many times the parabola crosses the x-axis, from the sign of b^2 - 4ac.',
    example: 'x^2 + 6x + 11 = 0. How many distinct real solutions does the equation have?',
    trap: 'Computing the discriminant correctly and then misreading zero as "no solutions".' },

  { id: 'adv-nleq-radical', skill: 'adv-nleq',
    label: 'Solve a radical equation',
    asks: 'A square root containing x, equal to a number. Square both sides and finish.',
    example: 'sqrt(3x + 4) = 7. What is the solution?',
    trap: 'Subtracting the number instead of squaring it, or stopping at the squared value.' },

  { id: 'adv-nlfn-vertex', skill: 'adv-nlfn',
    label: 'Minimum or maximum of a parabola',
    asks: 'A quadratic in vertex form, asking for its least or greatest value.',
    example: 'f(x) = 2(x - 3)^2 - 11. What is the minimum value of f ?',
    trap: 'Reporting the x-coordinate of the vertex instead of the value there - giving 3 rather than -11.' },

  { id: 'adv-nlfn-exp-model', skill: 'adv-nlfn',
    label: 'Read an exponential model',
    asks: 'An exponential function with a decimal base, asking which description of it is correct.',
    example: 'A(t) = 4200(0.86)^t. Which statement best describes the model?',
    trap: 'Reading the base 0.86 as a 86% decrease rather than a 14% one.' },

  { id: 'adv-nlfn-exp-evaluate', skill: 'adv-nlfn',
    label: 'Evaluate an exponential function',
    asks: 'Substitute a small whole number into a growth function.',
    example: 'f(x) = 5(3)^x. What is the value of f(4) ?',
    trap: 'Multiplying the coefficient by the base by the exponent instead of raising to the power.' },

  { id: 'adv-nlfn-composite', skill: 'adv-nlfn',
    label: 'Composite functions',
    asks: 'Two functions given; evaluate one inside the other.',
    example: 'f(x) = 3x - 2 and g(x) = 2x + 5. What is the value of f(g(1)) ?',
    trap: 'Composing in the wrong order, or stopping after the inner function.' },

  /* ============================ Problem-Solving and Data Analysis */
  { id: 'psda-ratio-rate', skill: 'psda-ratio',
    label: 'Rates and proportions',
    asks: 'A rate stated for one quantity, scaled up or down to another.',
    example: 'A pump moves 84 litres every 4 seconds. How many litres in 60 seconds?',
    trap: 'Setting the proportion up upside down, so the answer comes out inverted.' },

  { id: 'psda-ratio-units', skill: 'psda-ratio',
    label: 'Unit conversion',
    asks: 'A measurement restated in different units, with the conversion factor supplied.',
    example: 'A measurement is 7 kilograms. What is it in grams?',
    trap: 'Dividing where you should multiply - going the wrong way through the factor.' },

  { id: 'psda-pct-of', skill: 'psda-pct',
    label: 'Percent of a number',
    asks: 'A straight percentage of a quantity.',
    example: 'What is 15% of 640 ?',
    trap: 'Misplacing the decimal, so the answer is out by a factor of ten.' },

  { id: 'psda-pct-change', skill: 'psda-pct',
    label: 'One percent increase or decrease',
    asks: 'A quantity moved up or down by a percentage; the NEW amount is wanted.',
    example: 'A price of $480 is increased by 25%. What is the new price?',
    trap: 'Reporting the size of the change instead of the new total.' },

  { id: 'psda-pct-successive', skill: 'psda-pct',
    label: 'Two percent changes in a row',
    asks: 'Up by one percentage, then down by another. The two do not cancel.',
    example: 'A quantity of 800 is increased by 25%, then decreased by 20%. What is the final quantity?',
    trap: 'Adding the percentages (+25 - 20 = +5%) instead of multiplying the two growth factors.' },

  { id: 'psda-pct-reverse', skill: 'psda-pct',
    label: 'Work backwards from a percent change',
    asks: 'The amount AFTER a change is given; the amount before it is wanted.',
    example: 'After a 25% increase, a quantity is 500. What was it before?',
    trap: 'Taking 25% off the new value. Undoing a x1.25 means dividing by 1.25, not subtracting 25%.' },

  { id: 'psda-1var-center', skill: 'psda-1var',
    label: 'Mean, median and range',
    asks: 'A short list of numbers and one named statistic to compute.',
    example: 'Data set: 4, 9, 12, 15, 27. What is the median of the data set?',
    trap: 'Computing a different statistic than the one named - the median when the mean was asked for.' },

  { id: 'psda-1var-spread', skill: 'psda-1var',
    label: 'Effect of an outlier',
    asks: 'One far-out value added to a data set; what happens to the mean and the median.',
    example: 'A value of 300 is added to a set clustered near 30. What is the effect on the mean and median?',
    trap: 'Assuming both move together. The mean uses every value; the median only counts positions.' },

  { id: 'psda-2var-scatter', skill: 'psda-2var',
    label: 'Predict from a line of best fit',
    asks: 'A fitted model given as an equation, used to predict at a stated input.',
    example: 'A line of best fit is y = 12x + 40. What does the model predict at x = 15 ?',
    trap: 'Dropping the intercept, or adding x to the intercept instead of multiplying by the slope.' },

  { id: 'psda-prob-table', skill: 'psda-prob',
    label: 'Probability from a two-way table',
    asks: 'A table of counts. Sometimes the whole table is the denominator; sometimes one row is.',
    example: 'Given the table, one Group A entry is chosen at random. What is the probability it is Passed?',
    trap: 'The whole question. A conditional probability uses the ROW total; using the grand total is the standard error.' },

  /* ============================== Geometry and Trigonometry */
  { id: 'geo-areavol-rect', skill: 'geo-areavol',
    label: 'Area of a rectangle',
    asks: 'Area and one side given, the other side wanted - the formula run backwards.',
    example: 'A rectangle has area 96 cm^2 and width 8 cm. What is its length?',
    trap: 'Subtracting the known side from the area instead of dividing.' },

  { id: 'geo-areavol-tri', skill: 'geo-areavol',
    label: 'Area of a triangle',
    asks: 'The one-half in the triangle formula, usually solved for a missing base or height.',
    example: 'A triangle has area 54 cm^2 and base 12 cm. What is its height?',
    trap: 'Forgetting the factor of one-half, which halves or doubles the answer.' },

  { id: 'geo-areavol-circle', skill: 'geo-areavol',
    label: 'Area of a circle',
    asks: 'Area from a radius or diameter.',
    example: 'A circle has a diameter of 14 cm. What is its area, in terms of pi ?',
    trap: 'Using the diameter where the formula wants the radius, which makes the answer four times too big.' },

  { id: 'geo-areavol-box', skill: 'geo-areavol',
    label: 'Volume of a rectangular solid',
    asks: 'Three dimensions multiplied, or one recovered from the volume.',
    example: 'A box has volume 240 cm^3, length 8 cm and width 5 cm. What is its height?',
    trap: 'Using a surface-area formula, or adding the dimensions instead of multiplying.' },

  { id: 'geo-areavol-cyl', skill: 'geo-areavol',
    label: 'Volume of a cylinder',
    asks: 'A circular base times a height.',
    example: 'A cylinder has radius 3 cm and height 10 cm. What is its volume, in terms of pi ?',
    trap: 'Forgetting to square the radius.' },

  { id: 'geo-lines-trianglesum', skill: 'geo-lines',
    label: 'Angles in a triangle',
    asks: 'The three interior angles add to 180.',
    example: 'Two angles of a triangle are 47 and 68 degrees. What is the third?',
    trap: 'Using 360 instead of 180.' },

  { id: 'geo-lines-parallel', skill: 'geo-lines',
    label: 'Parallel lines and a transversal',
    asks: 'Which angles are equal and which are supplementary when a line crosses two parallel lines.',
    example: 'Lines m and n are parallel. One angle is 118 degrees. What is the marked angle?',
    trap: 'Taking the equal angle when the supplementary one was marked, giving 62 for 118 or the reverse.' },

  { id: 'geo-lines-exterior', skill: 'geo-lines',
    label: 'Exterior angle of a triangle',
    asks: 'An exterior angle equals the sum of the two opposite interior angles.',
    example: 'A triangle has interior angles 40 and 75 degrees. What is the exterior angle at the third vertex?',
    trap: 'Subtracting from 180 twice, or using the adjacent interior angle instead of the two remote ones.' },

  { id: 'geo-lines-similar', skill: 'geo-lines',
    label: 'Similar triangles',
    asks: 'Two triangles with equal angles; corresponding sides are in a fixed ratio.',
    example: 'Triangle ABC is similar to triangle DEF. AB = 6, DE = 9, BC = 8. What is EF ?',
    trap: 'Pairing sides that do not correspond, or adding the scale factor instead of multiplying by it.' },

  { id: 'geo-right-pythagorean', skill: 'geo-right',
    label: 'Pythagorean theorem',
    asks: 'A missing side of a right triangle from the other two.',
    example: 'A right triangle has legs 9 and 12. What is the length of the hypotenuse?',
    trap: 'Adding the squares when finding a leg, where you must subtract them.' },

  { id: 'geo-right-trig-ratio', skill: 'geo-right',
    label: 'Sine, cosine and tangent',
    asks: 'One trig ratio of an acute angle in a right triangle.',
    example: 'In a right triangle the side opposite angle A is 7 and the hypotenuse is 25. What is sin A ?',
    trap: 'Picking the wrong two sides - the classic sine-for-cosine swap.' },

  { id: 'geo-right-trig-complementary', skill: 'geo-right',
    label: 'Sine and cosine of complementary angles',
    asks: 'That sin x = cos(90 - x), used to convert between the two.',
    example: 'If sin x = 0.6, what is cos(90 - x) ?',
    trap: 'Assuming the two are opposites, or subtracting the value from 1 instead of the angle from 90.' },

  { id: 'geo-circle-equation', skill: 'geo-circle',
    label: 'Equation of a circle',
    asks: 'Centre and radius read out of, or built into, (x - h)^2 + (y - k)^2 = r^2.',
    example: 'A circle has equation (x - 3)^2 + (y + 5)^2 = 49. What is its centre?',
    trap: 'Getting the signs of the centre backwards, and using r^2 where r was wanted.' },

  { id: 'geo-circle-arc', skill: 'geo-circle',
    label: 'Arc length',
    asks: 'A fraction of the circumference, set by the central angle.',
    example: 'A circle of radius 9 has a central angle of 80 degrees. What is the arc length?',
    trap: 'Using the area formula, or forgetting to scale by angle over 360.' },

  { id: 'geo-circle-sector', skill: 'geo-circle',
    label: 'Sector area',
    asks: 'A fraction of the area, set by the central angle.',
    example: 'A circle of radius 6 has a sector with central angle 120 degrees. What is the sector area?',
    trap: 'Confusing sector area with arc length - one uses r^2, the other r.' },

  { id: 'geo-circle-radians', skill: 'geo-circle',
    label: 'Degrees and radians',
    asks: 'Converting an angle between degrees and radians.',
    example: 'What is 135 degrees in radians?',
    trap: 'Multiplying by 180/pi when you needed pi/180.' },

  /* ================================== R&W: Information and Ideas */
  { id: 'rw-central-idea', skill: 'rw-central',
    label: 'Main idea of a passage',
    asks: 'The one sentence that covers the whole text - not one true detail from inside it.',
    example: 'Which choice best states the main idea of the text?',
    trap: 'Choosing a statement that is true but too narrow, or one that overreaches beyond what the text says.' },

  { id: 'rw-evidence-textual', skill: 'rw-evidence-text',
    label: 'Which detail supports the claim',
    asks: 'A claim is stated; find the detail in the text that actually backs it up.',
    example: 'Which finding, if true, would most directly support the conclusion drawn by the researchers?',
    trap: 'Picking a choice that is on-topic and relevant but supports a slightly different claim.' },

  { id: 'rw-evidence-quantitative', skill: 'rw-evidence-quant',
    label: 'Which data supports the claim',
    asks: 'The same task, but the evidence is in a table or graph rather than the prose.',
    example: 'Which choice best describes data from the table that support the hypothesis?',
    trap: 'Choosing a statement that reads the graph correctly but does not bear on the claim being made.' },

  { id: 'rw-inference', skill: 'rw-infer',
    label: 'Complete the inference',
    asks: 'Finish the text with the conclusion its own logic forces - one step beyond what is written, no more.',
    example: 'Which choice most logically completes the text?',
    trap: 'Taking two steps instead of one, or importing outside knowledge the passage never offered.' },

  /* ==================================== R&W: Craft and Structure */
  { id: 'rw-words-in-context', skill: 'rw-words',
    label: 'Word in context',
    asks: 'Which word fits the blank, decided by the sentence around it rather than by the dictionary.',
    example: 'Which choice completes the text with the most logical and precise word?',
    trap: 'Choosing a word that shares a general sense but the wrong register or connotation for this sentence.' },

  { id: 'rw-text-structure', skill: 'rw-structure',
    label: 'Structure or purpose of a text',
    asks: 'What the text is DOING - how it is built, or why a sentence is where it is.',
    example: 'Which choice best describes the overall structure of the text?',
    trap: 'Describing what the text is about instead of how it is organised.' },

  { id: 'rw-cross-text', skill: 'rw-crosstext',
    label: 'Comparing two texts',
    asks: 'Two passages on one topic; how the second author would respond to the first.',
    example: 'Based on the texts, how would the author of Text 2 most likely respond to Text 1 ?',
    trap: 'Assuming the two authors must disagree. Sometimes one qualifies or extends the other.' },

  /* ==================================== R&W: Expression of Ideas */
  { id: 'rw-rhetorical-synthesis', skill: 'rw-synthesis',
    label: 'Use the notes to meet a goal',
    asks: 'Bullet-point notes plus a stated goal; pick the sentence that achieves THAT goal.',
    example: 'Which choice most effectively uses the notes to emphasise the scale of the study?',
    trap: 'Choosing an accurate sentence that serves a different goal than the one specified.' },

  { id: 'rw-transition', skill: 'rw-transitions',
    label: 'Transition word or phrase',
    asks: 'The logical relationship between two sentences: contrast, cause, addition, example, sequence.',
    example: 'Which transition best fits the blank between the two sentences?',
    trap: 'Reaching for "however" by default. Read whether the second sentence opposes the first or extends it.' },

  /* ============================ R&W: Standard English Conventions */
  { id: 'rw-boundaries-sentence', skill: 'rw-boundaries',
    label: 'Joining two complete sentences',
    asks: 'Two full sentences pushed together; choose punctuation that legally separates or joins them.',
    example: 'Glassblowing requires constant rotation of the pipe ___ gravity would otherwise pull the form out of true.',
    trap: 'The comma splice. A comma alone cannot join two independent clauses; it needs a conjunction or a stronger mark.' },

  { id: 'rw-boundaries-supplement', skill: 'rw-boundaries',
    label: 'Punctuating a supplement',
    asks: 'An extra descriptive phrase dropped into a sentence, needing matched punctuation on both sides.',
    example: 'The lead researcher ___ a specialist in deep-sea ecology ___ published the findings.',
    trap: 'Opening with a comma and closing with a dash. Whatever mark starts the interruption must finish it.' },

  { id: 'rw-fss-subject-verb', skill: 'rw-fss',
    label: 'Subject-verb agreement',
    asks: 'Whether the verb matches its subject in number, with words in between to distract you.',
    example: 'The collection of manuscripts held in the archive ___ rarely displayed.',
    trap: 'Agreeing with the nearest noun ("manuscripts") rather than the real subject ("collection").' },

  { id: 'rw-fss-pronoun', skill: 'rw-fss',
    label: 'Pronoun-antecedent agreement',
    asks: 'Whether a pronoun matches the thing it refers back to in number.',
    example: 'Each of the laboratories maintains ___ own calibration records.',
    trap: 'Missing that "each" is singular even though the phrase after it is plural.' },

  { id: 'rw-fss-genitive', skill: 'rw-fss',
    label: 'Plurals and possessives',
    asks: 'Choosing between plural, singular possessive and plural possessive, and between ' +
          'possessive determiners and contractions (its and it is, their and they are, there).',
    example: 'The ___ findings were published in three separate journals.',
    trap: 'Apostrophe placement. A possessive marked on the plural and one marked on the singular ' +
          'say different things, and only one of them fits the sentence.' },

  { id: 'rw-fss-modifier', skill: 'rw-fss',
    label: 'Modifier placement',
    asks: 'A descriptive opening phrase must attach to the right noun - the one immediately after it.',
    example: 'Having sequenced the genome, ___ identified the mutation.',
    trap: 'Leaving the modifier dangling, so the sentence claims the wrong thing performed the action.' },

  { id: 'rw-fss-verb-tense', skill: 'rw-fss',
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

  let page = null, pageOrigin = null;
  if (q && q.page) { page = q.page; pageOrigin = 'qtype'; }
  else if (s && s.page) { page = s.page; pageOrigin = 'skill'; }
  else { page = unit; pageOrigin = 'unit'; }

  let video = null, videoOrigin = null;
  if (q && q.video) { video = q.video; videoOrigin = 'qtype'; }
  else if (s && s.video) { video = s.video; videoOrigin = 'skill'; }

  return {
    page, pageOrigin,
    video, videoOrigin,
    /* The long-form Organic Chemistry Tutor video for the parent skill. Null
       for Reading and Writing, which he does not cover - and inventing a
       stand-in there would be worse than showing nothing. */
    oct: s && s.oct ? s.oct : null,
    skillName: s ? s.cb : null,
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
  enoughData, verify,
  domains: { D_ALG, D_ADV, D_PSDA, D_GEO, D_CRAFT, D_INFO, D_CONV, D_EXPR }
};

/* Self-check that does not need the generators: structural problems inside
   this file are reported the moment it loads. The generator cross-check runs
   later, from the question banks, once they exist. */
verify(null);

})(window);
