/* =========================================================================
   sat/math-questions.js - the Math section generators.

   Domain weights follow the real test: Algebra 35%, Advanced Math 35%,
   Problem-Solving & Data Analysis 15%, Geometry & Trigonometry 15%.

   Every generator obeys the same discipline:
     - sample the ANSWER first, derive coefficients from it
     - keep real-world magnitudes plausible (no $12 cars, no 400-year-olds)
     - build each distractor from a named misconception
     - verify grid-in answers actually fit the five-character box
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const U = SATG.satUtil;
const { term, signed, signedTerm, fmtFraction, fmtNumber, fmtMoney, fmtCount,
        makeMC, makeGrid, gridUsable, reduceFraction } = U;

const D_ALG  = 'Algebra';
const D_ADV  = 'Advanced Math';
const D_PSDA = 'Problem-Solving and Data Analysis';
const D_GEO  = 'Geometry and Trigonometry';

/* Range of coefficient magnitudes per difficulty tier. */
const RANGE = { easy: 9, medium: 14, hard: 22 };

/* Roughly one in four Math questions is a grid-in on the real test (about 11
   of 44). Only some archetypes can pose as a grid-in at all - "which
   expression is equivalent" has no single numeric answer - so the probability
   here is higher than 1/4 to land near 1/4 across the whole Math section. */
function wantGrid(rng) { return rng.bool(0.62); }

/* ============================================================== ALGEBRA */

/* 5.1  ax + b = cx + d.  Solution chosen first so it is always an integer. */
function linearOneVar(rng, diff) {
  const R = RANGE[diff];
  const x0 = rng.nz(12);
  let a, c;
  do { a = rng.nz(R); c = rng.nz(R); } while (a === c);
  const b = rng.int(-R, R);
  const d = a * x0 + b - c * x0;

  const stem = term(a, 'x') + signed(b) + ' = ' + term(c, 'x') + signed(d) +
               '\n\nWhat is the value of x ?';
  const explanation = 'Collect like terms: (' + a + ' - ' + c + ')x = ' + (d - b) +
                      ', so x = ' + x0 + '.';

  if (wantGrid(rng) && gridUsable(x0)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ALG, skill: 'linear-1var', difficulty: diff,
      stem, value: x0, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-1var', difficulty: diff,
    stem, correct: x0,
    distractors: [
      -x0,                    // sign error when isolating
      a * x0 + b,             // reported the value of the expression, not x
      x0 + (a > c ? 1 : -1),  // arithmetic slip of one
      (d - b) || x0 + 2       // divided by the wrong quantity
    ],
    explanation
  });
}

/* 5.2  Two-variable system. Solution picked first; lines forced independent. */
function linearSystem(rng, diff) {
  const R = { easy: 6, medium: 9, hard: 13 }[diff];
  const x0 = rng.int(-9, 9);
  const y0 = rng.nz(9);
  let a1, b1, a2, b2;
  do {
    a1 = rng.nz(R); b1 = rng.nz(R);
    a2 = rng.nz(R); b2 = rng.nz(R);
  } while (a1 * b2 - a2 * b1 === 0);

  const c1 = a1 * x0 + b1 * y0;
  const c2 = a2 * x0 + b2 * y0;

  const ask = rng.pick(['x', 'y', 'x + y', 'x - y']);
  const value = { 'x': x0, 'y': y0, 'x + y': x0 + y0, 'x - y': x0 - y0 }[ask];

  const stem = term(a1, 'x') + signedTerm(b1, 'y') + ' = ' + c1 + '\n' +
               term(a2, 'x') + signedTerm(b2, 'y') + ' = ' + c2 +
               '\n\nThe solution to the given system is (x, y). ' +
               'What is the value of ' + ask + ' ?';
  const explanation = 'Solving gives x = ' + x0 + ' and y = ' + y0 +
                      ', so ' + ask + ' = ' + value + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ALG, skill: 'systems', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'systems', difficulty: diff,
    stem, correct: value,
    distractors: [
      ask === 'x' ? y0 : x0,                              // solved for the other variable
      -value,                                             // sign error
      ask === 'x + y' ? x0 - y0 : x0 + y0,                // combined with the wrong sign
      value + rng.nz(3)
    ],
    explanation
  });
}

/* How many solutions - the conceptual variant. */
function systemSolutionCount(rng, diff) {
  const kind = rng.pick(['one', 'none', 'infinite']);
  const a1 = rng.nz(8), b1 = rng.nz(8), c1 = rng.int(-14, 14);
  let a2, b2, c2, correct;

  if (kind === 'one') {
    do { a2 = rng.nz(8); b2 = rng.nz(8); } while (a1 * b2 - a2 * b1 === 0);
    c2 = rng.int(-14, 14);
    correct = 'Exactly one';
  } else {
    const k = rng.pick([2, 3, -2, 4]);
    a2 = a1 * k; b2 = b1 * k;
    if (kind === 'infinite') { c2 = c1 * k; correct = 'Infinitely many'; }
    else { c2 = c1 * k + rng.nz(6); correct = 'No solution'; }
  }

  const stem = term(a1, 'x') + signedTerm(b1, 'y') + ' = ' + c1 + '\n' +
               term(a2, 'x') + signedTerm(b2, 'y') + ' = ' + c2 +
               '\n\nHow many solutions does the given system of equations have?';

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'system-solution-count', difficulty: diff,
    stem, correct,
    // "Exactly two" is never correct for a linear system; it is here because
    // students carry the rule over from quadratics.
    distractors: ['Exactly one', 'Exactly two', 'No solution', 'Infinitely many']
      .filter((s) => s !== correct),
    explanation: kind === 'one'
      ? 'The coefficients are not proportional, so the lines intersect exactly once.'
      : kind === 'none'
        ? 'The left sides are proportional but the constants are not, so the lines are parallel and never meet.'
        : 'The second equation is a multiple of the first, so the two equations describe the same line.'
  });
}

/* 5.3  Linear function in context. Magnitudes constrained per scenario. */
const LINEAR_CONTEXTS = [
  { subj: 'the total cost, in dollars, of a technician\'s visit',
    rate: [35, 140], start: [40, 220], t: [1, 10], tUnit: 'hours worked', f: 'C', rising: true,
    rateWord: 'dollars per hour', startWord: 'call-out fee in dollars' },
  { subj: 'the height, in centimetres, of a candle',
    rate: [1, 4], start: [18, 34], t: [1, 8], tUnit: 'hours since it was lit', f: 'h', rising: false,
    rateWord: 'centimetres burned per hour', startWord: 'original height in centimetres' },
  { subj: 'the number of books catalogued in a library',
    rate: [40, 260], start: [1200, 9000], t: [1, 24], tUnit: 'months', f: 'B', rising: true,
    rateWord: 'books catalogued per month', startWord: 'number of books at the start' },
  { subj: 'the volume of water, in litres, remaining in a tank',
    rate: [6, 45], start: [400, 2400], t: [1, 20], tUnit: 'minutes', f: 'V', rising: false,
    rateWord: 'litres drained per minute', startWord: 'starting volume in litres' },
  { subj: 'the temperature, in degrees Celsius, of a cooling casting',
    rate: [3, 12], start: [180, 620], t: [1, 15], tUnit: 'minutes since removal', f: 'T', rising: false,
    rateWord: 'degrees lost per minute', startWord: 'temperature at removal' }
];

function linearFunctionValue(rng, diff) {
  const ctx = rng.pick(LINEAR_CONTEXTS);
  const mag = rng.int(ctx.rate[0], ctx.rate[1]);
  const m = ctx.rising ? mag : -mag;
  const b = rng.int(ctx.start[0], ctx.start[1]);
  let t = rng.int(ctx.t[0], ctx.t[1]);

  // Never let a decreasing model run past zero - a tank cannot hold -80 litres.
  if (!ctx.rising) {
    const maxT = Math.floor((b - 1) / mag);
    if (maxT < 1) return linearFunctionValue(rng, diff);
    t = Math.min(t, maxT);
  }
  const value = m * t + b;

  const stem = 'The function ' + ctx.f + '(t) = ' + term(m, 't') + signed(b) +
               ' models ' + ctx.subj + ', where t is the number of ' + ctx.tUnit + '.' +
               '\n\nWhat is the value of ' + ctx.f + '(' + t + ') ?';
  const explanation = ctx.f + '(' + t + ') = ' + m + '(' + t + ') + ' + b + ' = ' + value + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ALG, skill: 'linear-functions', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-functions', difficulty: diff,
    stem, correct: value,
    distractors: [
      m * t,            // dropped the initial value
      b - m * t,        // sign error on the rate term
      m * (t + 1) + b,  // off by one on t
      m + b             // substituted t = 1 out of habit
    ],
    explanation
  });
}

/* Slope/intercept meaning - pure interpretation, no arithmetic. */
function linearInterpretation(rng, diff) {
  const ctx = rng.pick(LINEAR_CONTEXTS);
  const mag = rng.int(ctx.rate[0], ctx.rate[1]);
  const m = ctx.rising ? mag : -mag;
  const b = rng.int(ctx.start[0], ctx.start[1]);
  const askSlope = rng.bool();

  const stem = 'The function ' + ctx.f + '(t) = ' + term(m, 't') + signed(b) +
               ' models ' + ctx.subj + ', where t is the number of ' + ctx.tUnit + '.' +
               '\n\nWhich statement is the best interpretation of ' +
               (askSlope ? m : b) + ' in this context?';

  const dir = ctx.rising ? 'increases' : 'decreases';
  const antiDir = ctx.rising ? 'decreases' : 'increases';

  const correct = askSlope
    ? 'For each additional unit of t, the modelled quantity ' + dir + ' by ' + mag + '.'
    : 'When t = 0, the modelled quantity is ' + b + '.';

  const distractors = askSlope ? [
    'For each additional unit of t, the modelled quantity ' + antiDir + ' by ' + mag + '.',
    'When t = 0, the modelled quantity is ' + mag + '.',
    'The modelled quantity is ' + mag + ' when t = ' + b + '.'
  ] : [
    'For each additional unit of t, the modelled quantity ' + dir + ' by ' + b + '.',
    'When t = 0, the modelled quantity is ' + m + '.',
    'The modelled quantity reaches ' + b + ' after one unit of t.'
  ];

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-interpretation', difficulty: diff,
    stem, correct, distractors,
    explanation: askSlope
      ? 'The coefficient of t is the rate of change.'
      : 'The constant term is the value of the function when t = 0.'
  });
}

/* Linear inequality - least/greatest integer satisfying a condition. */
function linearInequality(rng, diff) {
  const R = RANGE[diff];
  const a = rng.int(2, R);
  const b = rng.int(-R, R);
  const bound = rng.int(-R * 2, R * 2);
  const dir = rng.pick(['≤', '≥']);

  // a*x + b (dir) bound   ->   x (dir) (bound - b)/a
  const thresholdRaw = (bound - b) / a;
  const asking = dir === '≤' ? 'greatest' : 'least';
  const value = dir === '≤' ? Math.floor(thresholdRaw) : Math.ceil(thresholdRaw);
  if (!isFinite(value) || Math.abs(value) > 400) return linearInequality(rng, diff);

  const stem = term(a, 'x') + signed(b) + ' ' + dir + ' ' + bound +
               '\n\nWhat is the ' + asking + ' integer value of x that satisfies the inequality?';

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-inequality', difficulty: diff,
    stem, correct: value,
    distractors: [
      dir === '≤' ? Math.ceil(thresholdRaw) : Math.floor(thresholdRaw), // rounded the wrong way
      -value,                                                           // flipped the sign
      value + (dir === '≤' ? 1 : -1)                                    // off by one at the boundary
    ],
    explanation: 'Isolating x gives x ' + dir + ' ' + fmtNumber(Math.round(thresholdRaw * 1000) / 1000) +
                 ', so the ' + asking + ' integer is ' + value + '.'
  });
}

/* ======================================================== ADVANCED MATH */

/* 5.4  Quadratic that factors over the integers. Roots picked first. */
function quadraticFactor(rng, diff) {
  const R = { easy: 6, medium: 9, hard: 12 }[diff];
  const a = diff === 'hard' ? rng.pick([1, 1, 2, 3]) : 1;
  let r1, r2;
  do { r1 = rng.nz(R); r2 = rng.nz(R); } while (r1 === r2);

  const b = -a * (r1 + r2);
  const c = a * r1 * r2;
  const greater = Math.max(r1, r2), lesser = Math.min(r1, r2);
  const askGreater = rng.bool();
  const value = askGreater ? greater : lesser;

  const lead = a === 1 ? 'x²' : a + 'x²';
  const stem = lead + signedTerm(b, 'x') + signed(c) + ' = 0' +
               '\n\nWhat is the ' + (askGreater ? 'greater' : 'lesser') +
               ' solution to the given equation?';
  // signed() already yields " - 5"; stripping a space here would render "(x- 5)".
  const explanation = 'The equation factors as ' + (a === 1 ? '' : a) +
                      '(x' + signed(-r1) + ')(x' + signed(-r2) +
                      ') = 0, giving x = ' + lesser + ' and x = ' + greater + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ADV, skill: 'quadratic-roots', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'quadratic-roots', difficulty: diff,
    stem, correct: value,
    distractors: [
      askGreater ? lesser : greater,  // took the wrong root
      -value,                         // sign error reading the factor
      -(askGreater ? lesser : greater),
      value + 1
    ],
    explanation
  });
}

/* Sum or product of roots - clean for grid-in, tests Vieta-style number sense. */
function quadraticVieta(rng, diff) {
  const a = rng.pick([1, 1, 2]);
  let r1, r2;
  do { r1 = rng.nz(9); r2 = rng.nz(9); } while (r1 === r2);
  const b = -a * (r1 + r2);
  const c = a * r1 * r2;
  const askSum = rng.bool();
  const value = askSum ? r1 + r2 : r1 * r2;

  const lead = a === 1 ? 'x²' : a + 'x²';
  const stem = lead + signedTerm(b, 'x') + signed(c) + ' = 0' +
               '\n\nThe given equation has solutions p and q. What is the value of ' +
               (askSum ? 'p + q' : 'pq') + ' ?';

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'quadratic-vieta', difficulty: diff,
    stem, correct: value,
    distractors: [
      -value,                              // dropped the sign from -b/a
      askSum ? r1 * r2 : r1 + r2,          // used the other relationship
      askSum ? b : c,                      // read the coefficient straight off
      value + a
    ],
    explanation: 'For ax² + bx + c = 0, the sum of the roots is -b/a and the product is c/a. ' +
                 'Here the roots are ' + r1 + ' and ' + r2 + '.'
  });
}

/* Vertex form - the min/max value. Classic trap: reporting h instead of k. */
function vertexForm(rng, diff) {
  const h = rng.int(-9, 9);
  const k = rng.int(-14, 14);
  const a = rng.pick([1, -1, 2, -2, 3, -3]);
  const isMin = a > 0;

  const stem = 'f(x) = ' + (a === 1 ? '' : a === -1 ? '-' : a) +
               '(x' + (h >= 0 ? ' - ' + h : ' + ' + Math.abs(h)) + ')²' + signed(k) +
               '\n\nWhat is the ' + (isMin ? 'minimum' : 'maximum') +
               ' value of the function f ?';

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'quadratic-vertex', difficulty: diff,
    stem, correct: k,
    distractors: [
      h,       // gave the x-coordinate of the vertex instead of the value
      -k,      // sign error reading the constant
      -h,
      a
    ],
    explanation: 'The vertex is at (' + h + ', ' + k + '). Since a = ' + a + ' is ' +
                 (isMin ? 'positive' : 'negative') + ', the parabola opens ' +
                 (isMin ? 'upward and ' + k + ' is the minimum' : 'downward and ' + k + ' is the maximum') + '.'
  });
}

/* Discriminant - the number of distinct real solutions. */
function discriminant(rng, diff) {
  const a = rng.pick([1, 1, 2, -1, 3]);
  const b = rng.int(-10, 10);
  const want = rng.pick([2, 1, 0]);

  // Build c so the classification is exact rather than approximately right.
  let c;
  if (want === 1) {
    // Needs b² = 4ac exactly; only attempt when it divides cleanly.
    if ((b * b) % (4 * a) !== 0) return discriminant(rng, diff);
    c = (b * b) / (4 * a);
  } else if (want === 2) {
    c = Math.floor((b * b) / (4 * a)) - rng.int(1, 5);
    if (a < 0) c = Math.ceil((b * b) / (4 * a)) + rng.int(1, 5);
  } else {
    c = Math.floor((b * b) / (4 * a)) + rng.int(1, 5);
    if (a < 0) c = Math.ceil((b * b) / (4 * a)) - rng.int(1, 5);
  }

  const disc = b * b - 4 * a * c;
  const correct = disc > 0 ? 'Two' : disc === 0 ? 'One' : 'Zero';

  const stem = (a === 1 ? 'x²' : a === -1 ? '-x²' : a + 'x²') + signedTerm(b, 'x') + signed(c) + ' = 0' +
               '\n\nHow many distinct real solutions does the given equation have?';

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'discriminant', difficulty: diff,
    stem, correct,
    distractors: ['Two', 'One', 'Zero', 'Infinitely many'].filter((s) => s !== correct),
    explanation: 'The discriminant is b² - 4ac = ' + (b * b) + ' - ' + (4 * a * c) + ' = ' + disc +
                 ', which is ' + (disc > 0 ? 'positive, so there are two real solutions.'
                   : disc === 0 ? 'zero, so there is exactly one real solution.'
                   : 'negative, so there are no real solutions.')
  });
}

/* 5.5  Exponential model - interpretation form, so no ugly decimals appear. */
const EXP_CONTEXTS = [
  { subj: 'the number of bacteria in a culture', unit: 'hour', A0: [200, 5000], r: [5, 45], growth: true },
  { subj: 'the value, in dollars, of an investment', unit: 'year', A0: [800, 40000], r: [2, 14], growth: true },
  { subj: 'the mass, in grams, of a radioactive sample', unit: 'year', A0: [60, 900], r: [3, 32], growth: false },
  { subj: 'the resale value, in dollars, of a car', unit: 'year', A0: [9000, 52000], r: [8, 24], growth: false },
  { subj: 'the number of users of an application', unit: 'month', A0: [1500, 60000], r: [4, 30], growth: true }
];

function exponentialModel(rng, diff) {
  const ctx = rng.pick(EXP_CONTEXTS);
  const A0 = rng.int(ctx.A0[0], ctx.A0[1]);
  const rPct = rng.int(ctx.r[0], ctx.r[1]);
  const factor = ctx.growth ? 1 + rPct / 100 : 1 - rPct / 100;
  const fStr = factor.toFixed(2);
  const dir = ctx.growth ? 'increases' : 'decreases';
  const antiDir = ctx.growth ? 'decreases' : 'increases';

  const stem = 'A(t) = ' + A0 + '(' + fStr + ')ᵗ' +
               '\n\nThe function A models ' + ctx.subj + ', where t is the number of ' +
               ctx.unit + 's since measurements began.' +
               '\n\nWhich statement best describes the model?';

  const correct = 'The initial value is ' + fmtCount(A0) + ', and it ' + dir +
                  ' by ' + rPct + '% each ' + ctx.unit + '.';

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'exponential-model', difficulty: diff,
    stem, correct,
    distractors: [
      // flipped growth for decay
      'The initial value is ' + fmtCount(A0) + ', and it ' + antiDir + ' by ' + rPct + '% each ' + ctx.unit + '.',
      // read the base as the rate instead of computing 1 - r
      'The initial value is ' + fmtCount(A0) + ', and it ' + dir + ' by ' + (100 - rPct) + '% each ' + ctx.unit + '.',
      // swapped which number plays which role
      'The initial value is ' + fStr + ', and it ' + dir + ' by ' + fmtCount(A0) + '% each ' + ctx.unit + '.'
    ],
    explanation: 'In A(t) = A₀·bᵗ the coefficient ' + fmtCount(A0) + ' is the initial value. Since b = ' +
                 fStr + ', the quantity ' + dir + ' by ' + rPct + '% per ' + ctx.unit + '.'
  });
}

/* Exponential evaluated at a small t, kept to clean arithmetic. */
function exponentialEvaluate(rng, diff) {
  const base = rng.pick([2, 3, 5, 10]);
  const A0 = rng.pick([3, 4, 5, 6, 8, 12, 20, 25]);
  const t = rng.int(2, base === 10 ? 3 : 4);
  const value = A0 * Math.pow(base, t);

  const stem = 'f(x) = ' + A0 + '(' + base + ')ˣ' +
               '\n\nWhat is the value of f(' + t + ') ?';
  const explanation = 'f(' + t + ') = ' + A0 + ' × ' + base + '^' + t + ' = ' +
                      A0 + ' × ' + Math.pow(base, t) + ' = ' + value + '.';

  if (gridUsable(value) && wantGrid(rng)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ADV, skill: 'exponential-evaluate', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'exponential-evaluate', difficulty: diff,
    stem, correct: value,
    distractors: [
      A0 * base * t,              // multiplied instead of exponentiated
      Math.pow(A0 * base, t),     // applied the exponent to the coefficient too
      A0 * Math.pow(base, t - 1), // off by one in the exponent
      value + A0
    ],
    explanation
  });
}

/* 5.6  Equivalent expressions: difference of squares and perfect squares. */
function equivalentExpression(rng, diff) {
  const kind = rng.pick(['diffSquares', 'expandBinomial', 'factorTrinomial']);
  /* a starts at 2 deliberately: at a = 1 the "mishandled leading coefficient"
     distractor below collapses into the correct factorisation. */
  const a = rng.int(2, 6), b = rng.int(1, 11);

  if (kind === 'diffSquares') {
    const stem = 'Which expression is equivalent to ' + (a * a) + 'x² - ' + (b * b) + ' ?';
    return makeMC(rng, {
      section: 'math', domain: D_ADV, skill: 'equivalent-expressions', difficulty: diff,
      stem,
      correct: '(' + term(a, 'x') + ' - ' + b + ')(' + term(a, 'x') + ' + ' + b + ')',
      distractors: [
        '(' + term(a, 'x') + ' - ' + b + ')²',              // treated it as a perfect square
        '(' + term(a, 'x') + ' + ' + b + ')²',
        '(' + term(a * a, 'x') + ' - ' + b + ')(x + ' + b + ')'  // mishandled the leading coefficient
      ],
      explanation: 'This is a difference of squares: A² - B² = (A - B)(A + B) with A = ' +
                   term(a, 'x') + ' and B = ' + b + '.'
    });
  }

  if (kind === 'expandBinomial') {
    /* p === -q would make the middle term vanish, and the "forgot the cross
       terms" distractor would then be the correct expansion. */
    let p = rng.nz(7), q = rng.nz(7);
    while (p === -q) q = rng.nz(7);
    const stem = 'Which expression is equivalent to (x' + signed(p) + ')(x' + signed(q) + ') ?';
    const mid = p + q, last = p * q;
    return makeMC(rng, {
      section: 'math', domain: D_ADV, skill: 'equivalent-expressions', difficulty: diff,
      stem,
      correct: 'x²' + signedTerm(mid, 'x') + signed(last),
      distractors: [
        'x²' + signedTerm(last, 'x') + signed(mid),   // swapped the middle and last terms
        'x²' + signed(last),                          // forgot the cross terms entirely
        'x²' + signedTerm(mid, 'x') + signed(-last)   // sign error on the product
      ],
      explanation: 'Expanding gives x² + (' + p + ' + ' + q + ')x + (' + p + ')(' + q + ') = x²' +
                   signedTerm(mid, 'x') + signed(last) + '.'
    });
  }

  // factorTrinomial
  /* r1 === -r2 is excluded as well as r1 === r2: with opposite roots the
     "both signs flipped" distractor is the same two factors in the other
     order, i.e. a second correct answer rather than a wrong one. */
  let r1, r2;
  do { r1 = rng.nz(8); r2 = rng.nz(8); } while (r1 === r2 || r1 === -r2);
  const mid = -(r1 + r2), last = r1 * r2;
  const stem = 'Which expression is equivalent to x²' + signedTerm(mid, 'x') + signed(last) + ' ?';
  const f = (r) => '(x' + (r >= 0 ? ' - ' + r : ' + ' + Math.abs(r)) + ')';
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'equivalent-expressions', difficulty: diff,
    stem,
    correct: f(r1) + f(r2),
    distractors: [
      f(-r1) + f(-r2),        // both signs flipped
      f(r1) + f(-r2),         // one sign flipped
      f(r1 + r2) + '(x)'      // split the middle coefficient instead of factoring
    ],
    explanation: 'Look for two numbers multiplying to ' + last + ' and summing to ' + mid +
                 ': they are ' + (-r1) + ' and ' + (-r2) + '.'
  });
}

/* Exponent rules - a reliable, purely symbolic archetype. */
function exponentRules(rng, diff) {
  const a = rng.int(2, 9), m = rng.int(2, 7), n = rng.int(2, 7);
  const kind = rng.pick(['product', 'power', 'quotient', 'negative']);

  let stem, correct, distractors, explanation;
  if (kind === 'product') {
    stem = 'Which expression is equivalent to (' + a + 'x^' + m + ')(x^' + n + ') ?';
    correct = a + 'x^' + (m + n);
    distractors = [a + 'x^' + (m * n), a + 'x^' + Math.abs(m - n), (a * a) + 'x^' + (m + n)];
    explanation = 'Multiplying powers of the same base adds the exponents: x^' + m + ' · x^' + n +
                  ' = x^' + (m + n) + '.';
  } else if (kind === 'power') {
    stem = 'Which expression is equivalent to (' + a + 'x^' + m + ')^' + n + ' ?';
    correct = Math.pow(a, n) + 'x^' + (m * n);
    distractors = [a + 'x^' + (m * n), Math.pow(a, n) + 'x^' + (m + n), (a * n) + 'x^' + (m * n)];
    explanation = 'Raising a product to a power raises each factor: ' + a + '^' + n + ' = ' +
                  Math.pow(a, n) + ', and x^' + m + ' raised to ' + n + ' is x^' + (m * n) + '.';
  } else if (kind === 'quotient') {
    /* The four exponents on offer are big-small, big+small, big*small and
       small. Resample until they are all distinct - big = 2*small in
       particular makes the "forgot to subtract" trap equal the key. */
    let big = Math.max(m, n) + 3, small = Math.min(m, n);
    let tries = 0;
    while (tries++ < 40 &&
           new Set([big - small, big + small, big * small, small]).size !== 4) {
      big = rng.int(4, 12);
      small = rng.int(2, big - 2);
    }
    stem = 'Which expression is equivalent to (x^' + big + ') / (x^' + small + ') ?';
    correct = 'x^' + (big - small);
    distractors = ['x^' + (big + small), 'x^' + (big * small), 'x^' + small];
    explanation = 'Dividing powers of the same base subtracts the exponents: ' + big + ' - ' +
                  small + ' = ' + (big - small) + '.';
  } else {
    stem = 'Which expression is equivalent to ' + a + 'x^(-' + m + ') ?';
    correct = a + '/x^' + m;
    distractors = ['-' + a + 'x^' + m, '1/(' + a + 'x^' + m + ')', '-' + a + '/x^' + m];
    explanation = 'A negative exponent moves the power to the denominator; the coefficient ' +
                  a + ' stays in the numerator.';
  }

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'exponent-rules', difficulty: diff,
    stem, correct, distractors, explanation
  });
}

/* 5.7  Radical equation, built backwards so the root is exact. */
function radicalEquation(rng, diff) {
  const x0 = rng.int(2, 30);
  const a = rng.int(1, 4);
  const inner = a * x0;                       // sqrt(a*x) with a*x a perfect square
  const sq = rng.pick([1, 4, 9, 16, 25, 36, 49, 64]);
  const k = Math.sqrt(sq);
  // Build  sqrt(a*x + c) = k   with  a*x + c = sq
  const c = sq - inner;
  const value = x0;

  const stem = '√(' + term(a, 'x') + signed(c) + ') = ' + k +
               '\n\nWhat is the solution to the given equation?';
  const explanation = 'Squaring both sides gives ' + term(a, 'x') + signed(c) + ' = ' + sq +
                      ', so x = ' + x0 + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ADV, skill: 'radical-equation', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'radical-equation', difficulty: diff,
    stem, correct: value,
    distractors: [
      (k - c) / a,       // subtracted k instead of squaring it
      sq,                // stopped at the squared value
      -value,
      value + k
    ],
    explanation
  });
}

/* Function notation - evaluate a composite or a nested substitution. */
function functionNotation(rng, diff) {
  const a = rng.nz(6), b = rng.int(-9, 9);
  const c = rng.nz(5), d = rng.int(-9, 9);
  const x = rng.int(-6, 6);
  const inner = c * x + d;
  const value = a * inner + b;

  const stem = 'f(x) = ' + term(a, 'x') + signed(b) + '\n' +
               'g(x) = ' + term(c, 'x') + signed(d) +
               '\n\nWhat is the value of f(g(' + x + ')) ?';
  const explanation = 'g(' + x + ') = ' + inner + ', then f(' + inner + ') = ' + value + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_ADV, skill: 'function-notation', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'function-notation', difficulty: diff,
    stem, correct: value,
    distractors: [
      c * (a * x + b) + d,   // composed in the wrong order
      inner,                 // stopped after evaluating g
      a * x + b,             // evaluated f directly at x
      value + a
    ],
    explanation
  });
}

/* 5.17  Complex numbers. */
function complexNumbers(rng, diff) {
  const a = rng.nz(8), b = rng.nz(8), c = rng.nz(8), d = rng.nz(8);
  const multiply = rng.bool();
  const im = (v) => (v >= 0 ? ' + ' + v + 'i' : ' - ' + Math.abs(v) + 'i');

  let re, imag, stem;
  if (multiply) {
    re = a * c - b * d;
    imag = a * d + b * c;
    stem = '(' + a + im(b) + ')(' + c + im(d) + ')' +
           '\n\nWhich expression is equivalent to the product above? (i = √-1)';
  } else {
    re = a + c;
    imag = b + d;
    stem = '(' + a + im(b) + ') + (' + c + im(d) + ')' +
           '\n\nWhich expression is equivalent to the sum above? (i = √-1)';
  }

  const correct = re + im(imag);
  const distractors = multiply ? [
    (a * c + b * d) + im(imag),      // forgot i² = -1
    re + im(a * d - b * c),          // sign error on the cross term
    (a * c) + im(b * d)              // multiplied only the matching parts
  ] : [
    (a - c) + im(b - d),             // subtracted instead of added
    re + im(b - d),
    (a + c + b + d) + ''             // collapsed real and imaginary parts together
  ];

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'complex-numbers', difficulty: diff,
    stem, correct, distractors,
    explanation: multiply
      ? 'FOIL, then replace i² with -1: real part ' + a + '·' + c + ' - ' + b + '·' + d +
        ' = ' + re + ', imaginary part ' + a + '·' + d + ' + ' + b + '·' + c + ' = ' + imag + '.'
      : 'Add real parts and imaginary parts separately.'
  });
}

/* ======================================= PROBLEM-SOLVING & DATA ANALYSIS */

/* 5.8  Rates and proportions. */
function ratesProportion(rng, diff) {
  const scenarios = [
    { s: 'A printing press produces {a} pages every {b} minutes.',
      q: 'At this rate, how many pages does it produce in {c} minutes?', aR: [40, 300], bR: [2, 8], cR: [10, 90] },
    { s: 'A recipe requires {a} grams of flour for every {b} servings.',
      q: 'At this rate, how many grams of flour are needed for {c} servings?', aR: [60, 400], bR: [2, 6], cR: [8, 40] },
    { s: 'A pump moves {a} litres of water every {b} seconds.',
      q: 'At this rate, how many litres does it move in {c} seconds?', aR: [5, 60], bR: [2, 5], cR: [20, 150] }
  ];
  const sc = rng.pick(scenarios);

  const b = rng.int(sc.bR[0], sc.bR[1]);
  const perUnit = rng.int(Math.ceil(sc.aR[0] / b), Math.floor(sc.aR[1] / b));
  const a = perUnit * b;                    // guarantees a clean unit rate
  let c = rng.int(sc.cR[0], sc.cR[1]);
  c = Math.max(b, Math.round(c / b) * b);   // and a clean final answer
  const value = perUnit * c;

  const passage = sc.s.replace('{a}', a).replace('{b}', b);
  const stem = passage + '\n\n' + sc.q.replace('{c}', c);
  const explanation = 'The unit rate is ' + a + ' ÷ ' + b + ' = ' + perUnit +
                      ' per unit, so the answer is ' + perUnit + ' × ' + c + ' = ' + fmtCount(value) + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_PSDA, skill: 'rates-proportions', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'rates-proportions', difficulty: diff,
    stem, correct: value,
    distractors: [
      Math.round(a * b / c) || value + 3,   // set the proportion up upside down
      Math.round(c / perUnit),              // divided instead of multiplied
      perUnit * c + a,                      // added the original amount again
      a * c
    ],
    explanation
  });
}

/* 5.9  Percentages, including the successive-change trap. */
function percentages(rng, diff) {
  const kind = rng.pick(['ofValue', 'change', 'successive', 'reverse']);

  if (kind === 'ofValue') {
    const pct = rng.pick([5, 8, 10, 12, 15, 20, 25, 30, 40, 60, 75]);
    const base = rng.int(4, 60) * 20;
    const value = base * pct / 100;
    const stem = 'What is ' + pct + '% of ' + fmtCount(base) + ' ?';
    return makeMC(rng, {
      section: 'math', domain: D_PSDA, skill: 'percentages', difficulty: diff,
      stem, correct: value,
      distractors: [base * pct / 10, base - value, base / pct, value * 2],
      explanation: pct + '% of ' + base + ' = 0.' + (pct < 10 ? '0' + pct : pct) + ' × ' +
                   base + ' = ' + value + '.'
    });
  }

  if (kind === 'change') {
    const pct = rng.pick([10, 12, 15, 20, 25, 30, 40, 50]);
    const up = rng.bool();
    const base = rng.int(5, 50) * 20;
    const value = up ? base * (1 + pct / 100) : base * (1 - pct / 100);
    const stem = 'The price of an item is ' + fmtMoney(base) + '. The price is then ' +
                 (up ? 'increased' : 'decreased') + ' by ' + pct + '%.' +
                 '\n\nWhat is the new price, in dollars?';
    return makeMC(rng, {
      section: 'math', domain: D_PSDA, skill: 'percentages', difficulty: diff,
      stem, correct: value,
      distractors: [
        up ? base * (1 - pct / 100) : base * (1 + pct / 100),  // moved the wrong way
        base * pct / 100,                                       // gave the change, not the new price
        base + pct,                                             // added the percent as dollars
        value + base * 0.01 * pct
      ],
      explanation: 'The new price is ' + base + ' × ' + (up ? 1 + pct / 100 : 1 - pct / 100).toFixed(2) +
                   ' = ' + fmtNumber(value) + '.'
    });
  }

  if (kind === 'successive') {
    const p1 = rng.pick([10, 20, 25, 50]);
    const p2 = rng.pick([10, 20, 25, 50]);
    const base = rng.int(4, 40) * 100;
    const value = base * (1 + p1 / 100) * (1 - p2 / 100);
    if (!Number.isInteger(value)) return percentages(rng, diff);

    const stem = 'A quantity of ' + fmtCount(base) + ' is increased by ' + p1 +
                 '%, and the result is then decreased by ' + p2 + '%.' +
                 '\n\nWhat is the final quantity?';
    return makeMC(rng, {
      section: 'math', domain: D_PSDA, skill: 'percentages', difficulty: diff,
      stem, correct: value,
      // The headline trap: adding the percentages instead of compounding them.
      distractors: [
        base * (1 + (p1 - p2) / 100),
        base,
        base * (1 - p1 / 100) * (1 + p2 / 100),
        value + base * 0.01
      ],
      explanation: 'Percent changes compound: ' + base + ' × ' + (1 + p1 / 100).toFixed(2) +
                   ' × ' + (1 - p2 / 100).toFixed(2) + ' = ' + fmtNumber(value) +
                   '. Adding the percentages is not equivalent.'
    });
  }

  // reverse: given the result, recover the original
  const pct = rng.pick([10, 20, 25, 50]);
  const original = rng.int(4, 40) * 25;
  const after = original * (1 + pct / 100);
  if (!Number.isInteger(after)) return percentages(rng, diff);

  const stem = 'After a ' + pct + '% increase, a quantity is ' + fmtCount(after) + '.' +
               '\n\nWhat was the quantity before the increase?';
  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'percentages', difficulty: diff,
    stem, correct: original,
    distractors: [
      after * (1 - pct / 100),   // subtracted the percent from the new value
      after - pct,
      after / pct,
      original + pct
    ],
    explanation: 'If x is the original, then x × ' + (1 + pct / 100).toFixed(2) + ' = ' + after +
                 ', so x = ' + original + '.'
  });
}

/* Unit conversion, with a genuine reciprocal-direction trap. */
function unitConversion(rng, diff) {
  const conversions = [
    { from: 'metres', to: 'centimetres', k: 100, vR: [2, 40] },
    { from: 'kilograms', to: 'grams', k: 1000, vR: [2, 20] },
    { from: 'hours', to: 'seconds', k: 3600, vR: [2, 12] },
    { from: 'litres', to: 'millilitres', k: 1000, vR: [2, 25] },
    { from: 'kilometres', to: 'metres', k: 1000, vR: [2, 30] }
  ];
  const c = rng.pick(conversions);
  const v = rng.int(c.vR[0], c.vR[1]);
  const value = v * c.k;

  const stem = 'A measurement is ' + v + ' ' + c.from + '.' +
               '\n\nWhat is this measurement in ' + c.to + '? (1 ' +
               c.from.replace(/s$/, '') + ' = ' + fmtCount(c.k) + ' ' + c.to + ')';

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'unit-conversion', difficulty: diff,
    stem, correct: value,
    distractors: [v / c.k, v + c.k, value * c.k, v * c.k / 10],
    explanation: v + ' × ' + fmtCount(c.k) + ' = ' + fmtCount(value) + ' ' + c.to + '.'
  });
}

/* 5.10  Two-way table probability, including the conditional variant. */
function twoWayTable(rng, diff) {
  const a = rng.int(8, 40), b = rng.int(8, 40);
  const c = rng.int(8, 40), d = rng.int(8, 40);
  const total = a + b + c + d;
  const rowLabels = rng.pick([['Group A', 'Group B'], ['Morning', 'Evening'], ['Model X', 'Model Y']]);
  const colLabels = rng.pick([['Passed', 'Failed'], ['Yes', 'No'], ['Defective', 'Acceptable']]);

  const conditional = rng.bool(0.5);
  const graphic = {
    type: 'table',
    columns: ['', colLabels[0], colLabels[1], 'Total'],
    rows: [
      [rowLabels[0], a, b, a + b],
      [rowLabels[1], c, d, c + d],
      ['Total', a + c, b + d, total]
    ]
  };

  let stem, num, den, explanation;
  if (conditional) {
    stem = 'The table summarises the results of a study.' +
           '\n\nOne of the ' + rowLabels[0].toLowerCase() + ' entries is selected at random. ' +
           'What is the probability that it is ' + colLabels[0].toLowerCase() + ' ?';
    num = a; den = a + b;
    explanation = 'The condition restricts to the ' + rowLabels[0] + ' row, which has ' + (a + b) +
                  ' entries, of which ' + a + ' are ' + colLabels[0] + '. The probability is ' +
                  fmtFraction(a, a + b) + '.';
  } else {
    stem = 'The table summarises the results of a study.' +
           '\n\nOne entry is selected at random from all entries. ' +
           'What is the probability that it is ' + colLabels[0].toLowerCase() + ' ?';
    num = a + c; den = total;
    explanation = 'There are ' + (a + c) + ' ' + colLabels[0] + ' entries out of ' + total +
                  ' total, giving ' + fmtFraction(a + c, total) + '.';
  }

  const [rn, rd] = reduceFraction(num, den);
  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'probability-table', difficulty: diff,
    stem, graphic,
    correct: fmtFraction(rn, rd),
    distractors: [
      fmtFraction(num, total),          // used the grand total as the denominator
      fmtFraction(den - num, den),      // took the complement
      fmtFraction(den, num)             // inverted the ratio
    ],
    explanation
  });
}

/* 5.11  Centre and spread, conceptual. */
function statisticsCenter(rng, diff) {
  const n = rng.int(5, 7);
  const data = [];
  for (let i = 0; i < n; i++) data.push(rng.int(2, 40));
  data.sort((p, q) => p - q);

  const sum = data.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const median = data[(n - 1) / 2 | 0] !== undefined && n % 2 === 1
    ? data[(n - 1) / 2]
    : (data[n / 2 - 1] + data[n / 2]) / 2;
  const range = data[n - 1] - data[0];

  const which = rng.pick(['median', 'range', 'mean']);
  const value = which === 'median' ? median : which === 'range' ? range : mean;
  if (which === 'mean' && !Number.isInteger(mean)) return statisticsCenter(rng, diff);

  const stem = 'A data set consists of the following values:\n\n' + data.join(',  ') +
               '\n\nWhat is the ' + which + ' of the data set?';
  const explanation = which === 'median'
    ? 'Ordered, the middle value is ' + median + '.'
    : which === 'range'
      ? 'The range is ' + data[n - 1] + ' - ' + data[0] + ' = ' + range + '.'
      : 'The sum is ' + sum + ' and there are ' + n + ' values, so the mean is ' + mean + '.';

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'statistics-center', difficulty: diff,
    stem, correct: value,
    distractors: [
      which === 'median' ? Math.round(mean * 100) / 100 : median,  // computed a different statistic
      range,
      data[n - 1],                                                  // reported the maximum
      Math.round(mean * 100) / 100 + 1
    ],
    explanation
  });
}

/* Effect of adding a point - the mean/median distinction the test loves. */
function statisticsEffect(rng, diff) {
  const base = [];
  for (let i = 0; i < 7; i++) base.push(rng.int(20, 40));
  base.sort((a, b) => a - b);
  const outlier = rng.int(180, 400);

  const stem = 'A data set has the values:\n\n' + base.join(',  ') +
               '\n\nA single new value of ' + outlier + ' is added to the data set.' +
               '\n\nWhich statement best describes the effect on the mean and the median?';

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'statistics-spread', difficulty: diff,
    stem,
    correct: 'The mean increases substantially, and the median changes only slightly.',
    distractors: [
      'The mean and the median both increase substantially.',
      'The median increases substantially, and the mean changes only slightly.',
      'Neither the mean nor the median changes.'
    ],
    explanation: 'The mean uses every value, so a far-out point pulls it strongly. ' +
                 'The median depends only on position, so an extreme value shifts it at most one place.'
  });
}

/* 5.12  Scatterplot / line of best fit, read as a model interpretation. */
function scatterModel(rng, diff) {
  const m = rng.int(2, 25);
  const b = rng.int(5, 90);
  const x = rng.int(4, 30);
  const value = m * x + b;

  const stem = 'A line of best fit for a set of data is given by y = ' + term(m, 'x') + signed(b) +
               ', where x is the number of weeks of training and y is the predicted score.' +
               '\n\nWhat score does the model predict after ' + x + ' weeks?';

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'scatter-model', difficulty: diff,
    stem, correct: value,
    distractors: [m * x, b + x, m + b + x, value + m],
    explanation: 'Substitute x = ' + x + ': y = ' + m + '(' + x + ') + ' + b + ' = ' + value + '.'
  });
}

/* ================================================ GEOMETRY & TRIGONOMETRY */

/* 5.13  Area and volume, solved for a missing dimension so it stays clean. */
function areaVolume(rng, diff) {
  const kind = rng.pick(['rectArea', 'triArea', 'boxVolume', 'cylVolume', 'circleArea']);

  if (kind === 'rectArea') {
    const w = rng.int(3, 20), h = rng.int(3, 20);
    const area = w * h;
    const stem = 'A rectangle has an area of ' + area + ' square centimetres and a width of ' +
                 w + ' centimetres.\n\nWhat is its length, in centimetres?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', difficulty: diff,
      stem, correct: h,
      distractors: [area - w, area / 2, 2 * (w + h), w],
      explanation: 'Length = area ÷ width = ' + area + ' ÷ ' + w + ' = ' + h + '.'
    });
  }

  if (kind === 'triArea') {
    const base = rng.int(2, 12) * 2;
    const height = rng.int(3, 18);
    const area = base * height / 2;
    const stem = 'A triangle has a base of ' + base + ' centimetres and a height of ' +
                 height + ' centimetres.\n\nWhat is its area, in square centimetres?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', difficulty: diff,
      stem, correct: area,
      distractors: [base * height, base + height, area / 2, base * height * 2],
      explanation: 'Area = ½ × base × height = ½ × ' + base + ' × ' + height + ' = ' + area + '.'
    });
  }

  if (kind === 'boxVolume') {
    const l = rng.int(2, 12), w = rng.int(2, 12), h = rng.int(2, 12);
    const vol = l * w * h;
    const stem = 'A rectangular box has a volume of ' + vol + ' cubic inches. Its length is ' +
                 l + ' inches and its width is ' + w + ' inches.' +
                 '\n\nWhat is its height, in inches?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', difficulty: diff,
      stem, correct: h,
      distractors: [vol / l, vol / w, l * w, vol - l * w],
      explanation: 'Height = volume ÷ (length × width) = ' + vol + ' ÷ ' + (l * w) + ' = ' + h + '.'
    });
  }

  if (kind === 'cylVolume') {
    const r = rng.int(2, 9), h = rng.int(2, 14);
    const coef = r * r * h;
    const stem = 'A right circular cylinder has radius ' + r + ' and height ' + h + '.' +
                 '\n\nWhat is its volume, in terms of π ?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', difficulty: diff,
      stem, correct: coef + 'π',
      distractors: [
        (2 * r * h) + 'π',        // used the lateral-surface formula
        (r * h) + 'π',            // forgot to square the radius
        (r * r * h * 3) + 'π'     // multiplied by 3 instead of using πr²h
      ],
      explanation: 'V = πr²h = π(' + r + ')²(' + h + ') = ' + coef + 'π.'
    });
  }

  // r starts at 3: at r = 2, r² equals 2r and the circumference distractor
  // would be the correct area.
  const r = rng.int(3, 15);
  const stem = 'A circle has a radius of ' + r + '.\n\nWhat is its area, in terms of π ?';
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'area-volume', difficulty: diff,
    stem, correct: (r * r) + 'π',
    distractors: [(2 * r) + 'π', r + 'π', (4 * r * r) + 'π'],  // circumference / radius / diameter-squared
    explanation: 'A = πr² = π(' + r + ')² = ' + (r * r) + 'π.'
  });
}

/* 5.14  Circle equations. */
function circleEquation(rng, diff) {
  let h = rng.int(-9, 9), k = rng.int(-9, 9);
  /* A circle centred on the origin makes the sign-flipped-centre distractor
     below IDENTICAL to the key: "(x - 0)" and "(x + 0)" are the same circle,
     and the string dedupe cannot see it because the text differs. Nudge the
     centre off the origin so that distractor is always genuinely wrong. */
  if (h === 0 && k === 0) h = rng.nz(9);
  const r = rng.int(2, 11);
  const fromGeneral = diff !== 'easy' && rng.bool(0.45);

  if (fromGeneral) {
    const Dc = -2 * h, E = -2 * k, F = h * h + k * k - r * r;
    const stem = 'x² + y²' + signedTerm(Dc, 'x') + signedTerm(E, 'y') + signed(F) + ' = 0' +
                 '\n\nWhat is the radius of the circle represented by the given equation?';
    const explanation = 'Completing the square gives (x' + (h >= 0 ? ' - ' + h : ' + ' + Math.abs(h)) +
                        ')² + (y' + (k >= 0 ? ' - ' + k : ' + ' + Math.abs(k)) + ')² = ' + (r * r) +
                        ', so the radius is ' + r + '.';
    if (wantGrid(rng) && gridUsable(r)) {
      return makeGrid(rng, {
        section: 'math', domain: D_GEO, skill: 'circle-equation', difficulty: diff,
        stem, value: r, explanation
      });
    }
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'circle-equation', difficulty: diff,
      stem, correct: r,
      distractors: [r * r, Math.abs(F), 2 * r],   // r² for r is the signature trap here
      explanation
    });
  }

  const sx = h >= 0 ? ' - ' + h : ' + ' + Math.abs(h);
  const sy = k >= 0 ? ' - ' + k : ' + ' + Math.abs(k);
  const fx = h >= 0 ? ' + ' + h : ' - ' + Math.abs(h);
  const fy = k >= 0 ? ' + ' + k : ' - ' + Math.abs(k);

  const stem = 'A circle in the xy-plane has centre (' + h + ', ' + k + ') and radius ' + r + '.' +
               '\n\nWhich equation represents this circle?';
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'circle-equation', difficulty: diff,
    stem,
    correct: '(x' + sx + ')² + (y' + sy + ')² = ' + (r * r),
    distractors: [
      '(x' + sx + ')² + (y' + sy + ')² = ' + r,          // forgot to square the radius
      '(x' + fx + ')² + (y' + fy + ')² = ' + (r * r),    // sign-flipped the centre
      '(x' + fx + ')² + (y' + fy + ')² = ' + r
    ],
    explanation: 'Standard form is (x - h)² + (y - k)² = r² with (h, k) = (' + h + ', ' + k +
                 ') and r = ' + r + ', so r² = ' + (r * r) + '.'
  });
}

/* Sector area and arc length, restricted to angles that divide 360 cleanly. */
const CLEAN_ANGLES = [30, 45, 60, 90, 120, 135, 150, 180, 240, 270];

function circleSector(rng, diff) {
  /* r starts at 3: at r = 2 the arc-length and sector-area expressions
     evaluate to the same coefficient, so the "confused the two formulas"
     distractor would be the correct answer. */
  const r = rng.int(3, 14);
  const deg = rng.pick(CLEAN_ANGLES);
  const askArc = rng.bool();

  if (askArc) {
    // arc = (deg/360) * 2πr
    const correct = piFrac(deg * 2 * r, 360);
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'circle-arc', difficulty: diff,
      stem: 'A circle has radius ' + r + '. An arc of the circle has a central angle of ' + deg +
            ' degrees.\n\nWhat is the length of the arc, in terms of π ?',
      correct,
      distractors: [
        piFrac(deg * r * r, 360),   // used the sector-area formula
        piFrac(deg * r, 360),       // dropped the factor of 2
        piFrac(2 * r, 1)            // gave the whole circumference
      ],
      explanation: 'Arc length = (θ/360) × 2πr = (' + deg + '/360) × 2π(' + r + ') = ' + correct + '.'
    });
  }

  const correct = piFrac(deg * r * r, 360);
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'circle-sector', difficulty: diff,
    stem: 'A circle has radius ' + r + '. A sector of the circle has a central angle of ' + deg +
          ' degrees.\n\nWhat is the area of the sector, in terms of π ?',
    correct,
    distractors: [
      piFrac(deg * 2 * r, 360),   // arc length instead
      piFrac(deg * r, 360),       // used r rather than r²
      piFrac(r * r, 1)            // gave the whole circle
    ],
    explanation: 'Sector area = (θ/360) × πr² = (' + deg + '/360) × π(' + r + ')² = ' + correct + '.'
  });
}

/* Render n/d as a multiple of π: 1/1 -> "π", 3/1 -> "3π", 1/4 -> "π/4". */
function piFrac(n, d) {
  const [rn, rd] = reduceFraction(n, d);
  const head = rn === 1 ? 'π' : rn === -1 ? '-π' : rn + 'π';
  return rd === 1 ? head : head + '/' + rd;
}

function radianConversion(rng, diff) {
  const toDegrees = rng.bool();
  const num = rng.pick([1, 2, 3, 4, 5, 7]);
  const den = rng.pick([2, 3, 4, 6]);
  const deg = num / den * 180;
  if (!Number.isInteger(deg) || deg > 360) return radianConversion(rng, diff);

  if (toDegrees) {
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'radians', difficulty: diff,
      stem: 'An angle measures ' + piFrac(num, den) + ' radians.' +
            '\n\nWhat is the measure of the angle, in degrees?',
      correct: deg,
      distractors: [deg / 2, deg * 2, 360 - deg, 180 - deg],
      explanation: 'Multiply by 180/π: (' + num + '/' + den + ') × 180 = ' + deg + ' degrees.'
    });
  }

  const [rn, rd] = reduceFraction(num, den);
  const correct = piFrac(rn, rd);
  /* Deliberately over-supplied and then deduped. When the measure reduces to
     a whole number of π (2/2 -> π) several of these formulas collapse onto
     the same string, and a key with no leading digit gives the generic
     fallback nothing to work from - so the surplus has to come from here. */
  const cands = [];
  for (const c of [piFrac(rd, rn),        // inverted the fraction
                   piFrac(rn, rd * 2),    // halved
                   piFrac(rn * 2, rd),    // doubled
                   piFrac(rn * 3, rd),
                   piFrac(rn, rd * 3),
                   piFrac(rn + 1, rd)]) {
    if (c !== correct && cands.indexOf(c) === -1) cands.push(c);
  }

  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'radians', difficulty: diff,
    stem: 'An angle measures ' + deg + ' degrees.' +
          '\n\nWhat is the measure of the angle, in radians?',
    correct,
    distractors: cands,
    explanation: 'Multiply by π/180: ' + deg + ' × π/180 = ' + correct + '.'
  });
}

/* 5.15  Right-triangle trig, always built from a scaled Pythagorean triple. */
const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41]];

function rightTriangleTrig(rng, diff) {
  const [p, q, hypBase] = rng.pick(TRIPLES);
  const k = rng.int(1, diff === 'hard' ? 4 : 2);
  const legA = p * k, legB = q * k, hyp = hypBase * k;

  const kind = rng.pick(['ratio', 'missingSide', 'identity']);

  if (kind === 'missingSide') {
    const findHyp = rng.bool();
    const value = findHyp ? hyp : legB;
    const stem = findHyp
      ? 'In right triangle ABC, the right angle is at C. Leg AC measures ' + legA +
        ' and leg BC measures ' + legB + '.\n\nWhat is the length of the hypotenuse AB?'
      : 'In right triangle ABC, the right angle is at C. Leg AC measures ' + legA +
        ' and the hypotenuse AB measures ' + hyp + '.\n\nWhat is the length of leg BC?';
    const explanation = findHyp
      ? 'a² + b² = c²: ' + legA + '² + ' + legB + '² = ' + (legA * legA + legB * legB) +
        ', and √' + (legA * legA + legB * legB) + ' = ' + hyp + '.'
      : 'c² - a² = b²: ' + hyp + '² - ' + legA + '² = ' + (hyp * hyp - legA * legA) +
        ', and √' + (hyp * hyp - legA * legA) + ' = ' + legB + '.';

    if (wantGrid(rng) && gridUsable(value)) {
      return makeGrid(rng, {
        section: 'math', domain: D_GEO, skill: 'right-triangle', difficulty: diff,
        stem, value, explanation
      });
    }
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'right-triangle', difficulty: diff,
      stem, correct: value,
      distractors: [
        findHyp ? legA + legB : hyp - legA,        // added or subtracted the sides directly
        findHyp ? legA * legA + legB * legB : hyp * hyp - legA * legA,  // stopped at the square
        value + 1, value - 1
      ],
      explanation
    });
  }

  if (kind === 'identity') {
    const sinT = fmtFraction(legA, hyp);
    const cosT = fmtFraction(legB, hyp);
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'pythagorean-identity', difficulty: diff,
      stem: 'In a right triangle, θ is an acute angle and sin(θ) = ' + sinT + '.' +
            '\n\nWhat is the value of cos(θ) ?',
      correct: cosT,
      distractors: [
        sinT,                                // repeated the given value
        fmtFraction(hyp, legB),              // reciprocal (secant)
        fmtFraction(legA, legB)              // gave the tangent instead
      ],
      explanation: 'sin²θ + cos²θ = 1. With sin(θ) = ' + sinT + ' the triangle has legs ' + legA +
                   ' and ' + legB + ' with hypotenuse ' + hyp + ', so cos(θ) = ' + cosT + '.'
    });
  }

  const angle = rng.pick(['A', 'B']);
  const opp = angle === 'A' ? legA : legB;
  const adj = angle === 'A' ? legB : legA;
  const fn = rng.pick(['sin', 'cos', 'tan']);
  const correct = fn === 'sin' ? fmtFraction(opp, hyp)
                : fn === 'cos' ? fmtFraction(adj, hyp)
                : fmtFraction(opp, adj);

  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'right-triangle-trig', difficulty: diff,
    stem: 'In right triangle ABC, the right angle is at C. Side BC measures ' + legA +
          ', side AC measures ' + legB + ', and the hypotenuse AB measures ' + hyp + '.' +
          '\n\nWhat is the value of ' + fn + '(' + angle + ') ?',
    correct,
    distractors: [
      fn === 'sin' ? fmtFraction(adj, hyp) : fn === 'cos' ? fmtFraction(opp, hyp) : fmtFraction(adj, opp),  // swapped sin/cos, or cot for tan
      fn === 'tan' ? fmtFraction(opp, hyp) : fmtFraction(hyp, fn === 'sin' ? opp : adj),                     // reciprocal
      fmtFraction(opp, adj) === correct ? fmtFraction(hyp, adj) : fmtFraction(opp, adj)
    ],
    explanation: 'SOH-CAH-TOA: ' + fn + '(' + angle + ') = ' +
                 (fn === 'sin' ? 'opposite/hypotenuse = ' + opp + '/' + hyp
                  : fn === 'cos' ? 'adjacent/hypotenuse = ' + adj + '/' + hyp
                  : 'opposite/adjacent = ' + opp + '/' + adj) + ' = ' + correct + '.'
  });
}

/* 5.16  Similar triangles. */
function similarTriangles(rng, diff) {
  const scale = rng.pick([2, 3, 4, 5]);
  const sides = [rng.int(3, 14), rng.int(3, 14), rng.int(3, 14)];
  const scaled = sides.map((s) => s * scale);
  const missing = rng.int(0, 2);
  const value = scaled[missing];

  const shown = scaled.map((v, i) => (i === missing ? '?' : v)).join(', ');
  const stem = 'Triangle ABC is similar to triangle DEF, with A corresponding to D, ' +
               'B to E, and C to F.\n\nThe sides of triangle ABC measure ' + sides.join(', ') +
               '.\nThe corresponding sides of triangle DEF measure ' + shown + '.' +
               '\n\nWhat is the length of the missing side?';
  const explanation = 'The scale factor is ' + scaled[(missing + 1) % 3] + ' ÷ ' +
                      sides[(missing + 1) % 3] + ' = ' + scale + ', so the missing side is ' +
                      sides[missing] + ' × ' + scale + ' = ' + value + '.';

  if (wantGrid(rng) && gridUsable(value)) {
    return makeGrid(rng, {
      section: 'math', domain: D_GEO, skill: 'similar-triangles', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'similar-triangles', difficulty: diff,
    stem, correct: value,
    distractors: [
      sides[missing],                   // forgot to scale at all
      sides[missing] * scale * scale,   // applied the area scale factor
      sides[missing] + scale,           // added instead of multiplied
      value + scale
    ],
    explanation
  });
}

/* Angles: parallel lines and triangle sums. */
function angleRelationships(rng, diff) {
  const kind = rng.pick(['triangleSum', 'parallelLines', 'exterior']);

  if (kind === 'triangleSum') {
    const a = rng.int(25, 85), b = rng.int(25, 85);
    const c = 180 - a - b;
    if (c < 15) return angleRelationships(rng, diff);
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'angles', difficulty: diff,
      stem: 'In triangle ABC, the measure of angle A is ' + a + ' degrees and the measure of ' +
            'angle B is ' + b + ' degrees.\n\nWhat is the measure of angle C, in degrees?',
      correct: c,
      distractors: [180 - a, 180 - b, a + b, 360 - a - b],
      explanation: 'The angles of a triangle sum to 180 degrees: 180 - ' + a + ' - ' + b + ' = ' + c + '.'
    });
  }

  if (kind === 'parallelLines') {
    const a = rng.int(30, 150);
    const askSupplement = rng.bool();
    const value = askSupplement ? 180 - a : a;
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'angles', difficulty: diff,
      stem: 'Two parallel lines are cut by a transversal. One of the eight angles formed ' +
            'measures ' + a + ' degrees.\n\nWhat is the measure, in degrees, of an angle that is ' +
            (askSupplement ? 'supplementary to' : 'vertical to') + ' this angle?',
      correct: value,
      distractors: [askSupplement ? a : 180 - a, 90 - a, 360 - a, a / 2],
      explanation: askSupplement
        ? 'Supplementary angles sum to 180 degrees: 180 - ' + a + ' = ' + (180 - a) + '.'
        : 'Vertical angles are congruent, so the measure is also ' + a + ' degrees.'
    });
  }

  const a = rng.int(30, 80), b = rng.int(30, 80);
  const ext = a + b;
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'angles', difficulty: diff,
    stem: 'In triangle ABC, the measures of angles A and B are ' + a + ' degrees and ' + b +
          ' degrees.\n\nWhat is the measure, in degrees, of the exterior angle at vertex C?',
    correct: ext,
    distractors: [180 - ext, 180 - a - b, 360 - ext, ext / 2],
    explanation: 'An exterior angle equals the sum of the two remote interior angles: ' +
                 a + ' + ' + b + ' = ' + ext + '.'
  });
}

/* =========================================================== registry */

/* Weights reproduce the real domain split: 35 / 35 / 15 / 15. */
const GENERATORS = [
  // Algebra - 35
  { w: 8, fn: linearOneVar },
  { w: 8, fn: linearSystem },
  { w: 4, fn: linearFunctionValue },
  { w: 5, fn: linearInterpretation },
  { w: 4, fn: linearInequality },
  { w: 3, fn: systemSolutionCount },
  { w: 3, fn: functionNotation },

  // Advanced Math - 35
  { w: 7, fn: quadraticFactor },
  { w: 4, fn: quadraticVieta },
  { w: 5, fn: vertexForm },
  { w: 4, fn: discriminant },
  { w: 5, fn: exponentialModel },
  { w: 3, fn: exponentialEvaluate },
  { w: 6, fn: equivalentExpression },
  { w: 4, fn: exponentRules },
  { w: 3, fn: radicalEquation },
  { w: 2, fn: complexNumbers },

  // Problem-Solving and Data Analysis - 15
  { w: 4, fn: ratesProportion },
  { w: 5, fn: percentages },
  { w: 3, fn: twoWayTable },
  { w: 3, fn: statisticsCenter },
  { w: 2, fn: statisticsEffect },
  { w: 2, fn: scatterModel },
  { w: 2, fn: unitConversion },

  // Geometry and Trigonometry - 15
  { w: 5, fn: areaVolume },
  { w: 4, fn: circleEquation },
  { w: 3, fn: circleSector },
  { w: 2, fn: radianConversion },
  { w: 5, fn: rightTriangleTrig },
  { w: 3, fn: similarTriangles },
  { w: 3, fn: angleRelationships }
];

function generate(rng, difficulty) {
  const pick = rng.weighted(GENERATORS);
  try {
    return pick.fn(rng, difficulty || 'medium');
  } catch (err) {
    // A generator that rejects its own sample too many times must never take
    // the run down mid-exam; fall back to the most robust archetype.
    console.warn('[sat] generator failed, falling back:', err);
    return linearOneVar(rng, difficulty || 'medium');
  }
}

SATG.mathQuestions = { generate, GENERATORS };

})(window);
