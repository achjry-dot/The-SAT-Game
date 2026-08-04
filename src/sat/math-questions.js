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
      section: 'math', domain: D_ALG, skill: 'linear-1var', qtype: 'alg-lin1-solve', difficulty: diff,
      stem, value: x0, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-1var', qtype: 'alg-lin1-solve', difficulty: diff,
    stem, correct: x0,
    distractors: [
      { v: -x0, why: 'Sign error when isolating.' },
      { v: a * x0 + b, why: 'Reported the value of the expression, not x.' },
      { v: x0 + (a > c ? 1 : -1), why: 'Arithmetic slip of one.' },
      { v: (d - b) || x0 + 2, why: 'Divided by the wrong quantity.' },
    ],
    explanation
  });
}

/* 5.1b  One equation with a parameter, asking how many solutions it has.

   The College Board asks this constantly and the bank had no generator for it,
   so `alg-lin1-count` sat in the taxonomy with nothing behind it - a question
   type the logbook could describe and never produce. */
function linearSolutionCount(rng, diff) {
  const a = rng.nz(9);
  const b = rng.int(-15, 15);
  const kind = rng.pick(['infinite', 'none', 'one']);

  let coef, konst, correct, explanation;
  if (kind === 'infinite') {
    coef = a; konst = b;
    correct = 'Infinitely many';
    explanation = 'With that coefficient the two sides become identical, so every value of x ' +
                  'satisfies the equation.';
  } else if (kind === 'none') {
    coef = a; konst = b + rng.nz(7);
    correct = 'No solution';
    explanation = 'The x terms cancel, leaving ' + b + ' = ' + konst +
                  ', which is false for every x - so nothing satisfies the equation.';
  } else {
    do { coef = rng.nz(9); } while (coef === a);
    konst = b;
    correct = 'Exactly one';
    explanation = 'The coefficients of x differ, so the terms do not cancel and the equation ' +
                  'has a single solution.';
  }

  const stem = term(a, 'x') + signed(b) + ' = ' + term(coef, 'x') + signed(konst) +
               '\n\nHow many solutions does the given equation have?';

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-equations', qtype: 'alg-lin1-count', difficulty: diff,
    stem, correct,
    distractors: ['Exactly one', 'Exactly two', 'No solution', 'Infinitely many']
      .filter((s) => s !== correct)
      .map((s) => {
        if (s === 'Exactly two') {
          return { v: s, why: 'A linear equation can never have exactly two solutions. Only a quadratic or higher can.' };
        }
        if (s === 'Exactly one') {
          return { v: s, why: 'One solution needs the x terms to survive. Here both sides have ' + a + 'x, so the x terms cancel entirely and there is nothing left to solve.' };
        }
        if (s === 'No solution') {
          return { v: s, why: kind === 'infinite'
            ? 'The constants match as well as the coefficients, so what is left after cancelling is TRUE rather than false - which means every x works, not none.'
            : 'The coefficients of x are different, so the terms do not cancel and there is a value of x that works.' };
        }
        return { v: s, why: kind === 'none'
          ? 'The x terms do cancel, but the constants left behind are not equal, so the statement is false for every x rather than true for every x.'
          : 'Infinitely many would need BOTH sides to be identical. The coefficients of x differ here.' };
      }),
    explanation
  });
}

/* 5.1c  Write the equation of a line. The other taxonomy entry that had no
   generator behind it. */
function writeLineEquation(rng, diff) {
  const kind = rng.pick(['twoPoints', 'perpendicular', 'parallel']);
  const x1 = rng.int(-7, 7);
  const y1 = rng.int(-9, 9);

  let m, b, stem, explanation;

  if (kind === 'twoPoints') {
    // Choose the run first so the slope is a whole number rather than a fraction.
    const run = rng.pick([1, 2, 3, -1, -2, -3]);
    m = rng.nz(5);
    const x2 = x1 + run, y2 = y1 + m * run;
    b = y1 - m * x1;
    stem = 'A line passes through the points (' + x1 + ', ' + y1 + ') and (' + x2 + ', ' + y2 + ').' +
           '\n\nWhich equation represents this line?';
    explanation = 'Slope = (' + y2 + ' - ' + y1 + ') / (' + x2 + ' - ' + x1 + ') = ' + m +
                  '. Substituting a point gives b = ' + b + '.';
  } else {
    const given = rng.nz(4);
    const gb = rng.int(-9, 9);
    m = kind === 'parallel' ? given : null;
    if (kind === 'perpendicular') {
      /* Perpendicular slope is -1/given, which is only a clean integer when the
         given slope is 1 or -1. Anything else would put a fraction in every
         answer choice, which is not what this type looks like on the real test. */
      const g = rng.pick([1, -1]);
      m = -1 / g;
      b = y1 - m * x1;
      stem = 'Line k passes through (' + x1 + ', ' + y1 + ') and is perpendicular to the line ' +
             'y = ' + term(g, 'x') + signed(gb) + '.' +
             '\n\nWhich equation represents line k ?';
      explanation = 'Perpendicular slopes are negative reciprocals, so the slope of k is ' + m +
                    '. Substituting (' + x1 + ', ' + y1 + ') gives b = ' + b + '.';
    } else {
      b = y1 - m * x1;
      stem = 'Line k passes through (' + x1 + ', ' + y1 + ') and is parallel to the line ' +
             'y = ' + term(given, 'x') + signed(gb) + '.' +
             '\n\nWhich equation represents line k ?';
      explanation = 'Parallel lines have equal slopes, so the slope of k is ' + m +
                    '. Substituting (' + x1 + ', ' + y1 + ') gives b = ' + b + '.';
    }
  }

  const eq = (slope, inter) => 'y = ' + term(slope, 'x') + signed(inter);

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-graphs', qtype: 'alg-lin2-write', difficulty: diff,
    stem, correct: eq(m, b),
    distractors: [
      { v: eq(m, -b), why: 'The slope is right but the intercept has the wrong sign. Substitute the given point back in and check that both sides balance.' },
      { v: eq(-m, b), why: 'The slope has the wrong sign. Sketch it: this line runs the other way.' },
      { v: eq(b, m), why: 'The slope and the intercept have swapped places. In y = mx + b the number attached to x is the slope.' },
      { v: eq(m, b + rng.nz(4)), why: 'The slope is right but the line sits at the wrong height - it does not pass through the given point.' }
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
      section: 'math', domain: D_ALG, skill: 'systems', qtype: 'alg-sys-solve', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'systems', qtype: 'alg-sys-solve', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: ask === 'x' ? y0 : x0, why: 'This is the OTHER variable. Both were found along the way; the question asked for ' + ask + '.' },
      { v: -value, why: 'Sign flipped. Substitute it back into both equations - one of them will not balance.' },
      { v: ask === 'x + y' ? x0 - y0 : x0 + y0, why: 'Combined the two solutions with the wrong operation.' },
      { v: value + rng.nz(3), why: 'Near the solution but not on it. Substituting this into both equations will not satisfy either.' }
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
    section: 'math', domain: D_ALG, skill: 'system-solution-count', qtype: 'alg-sys-count', difficulty: diff,
    stem, correct,
    /* "Exactly two" is never correct for a linear system; it is here because
       students carry the rule over from quadratics. Each reason is derived from
       what this particular system actually is, so the same wrong option gets a
       different explanation depending on the pair of lines in front of it. */
    distractors: ['Exactly one', 'Exactly two', 'No solution', 'Infinitely many']
      .filter((s) => s !== correct)
      .map((s) => {
        if (s === 'Exactly two') {
          return { v: s, why: 'Two straight lines can meet once, never, or everywhere - never in exactly two places. That answer belongs to quadratics.' };
        }
        if (s === 'Exactly one') {
          return { v: s, why: kind === 'none'
            ? 'The left sides ARE proportional here, so the lines have the same slope and run parallel. They never meet.'
            : 'The second equation is just the first one multiplied through, so the two describe the same line and share every point on it.' };
        }
        if (s === 'No solution') {
          return { v: s, why: kind === 'one'
            ? 'The coefficients are not proportional, so these lines have different slopes and must cross somewhere.'
            : 'The constants are proportional too, by the same multiplier, so the equations are the same line rather than parallel ones.' };
        }
        return { v: s, why: kind === 'one'
          ? 'Infinitely many would need one equation to be a multiple of the other. Here the coefficients are not proportional at all.'
          : 'The left sides are proportional but the constants are not, so the lines are parallel - same slope, different position, no shared point.' };
      }),
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
      section: 'math', domain: D_ALG, skill: 'linear-functions', qtype: 'alg-linfn-evaluate', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-functions', qtype: 'alg-linfn-evaluate', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: m * t, why: 'Dropped the initial value.' },
      { v: b - m * t, why: 'Sign error on the rate term.' },
      { v: m * (t + 1) + b, why: 'Off by one on t.' },
      { v: m + b, why: 'Substituted t = 1 out of habit.' },
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

  /* Two questions share one model, and the wrong answers are the same handful
     of confusions either way round: the sign of the rate, and the slope being
     read as the starting value or the other way about. */
  const distractors = askSlope ? [
    { v: 'For each additional unit of t, the modelled quantity ' + antiDir + ' by ' + mag + '.',
      why: 'Right size, wrong direction. The coefficient of t is ' + m + ', and its SIGN says whether the quantity ' + dir + ' or ' + antiDir + '.' },
    { v: 'When t = 0, the modelled quantity is ' + mag + '.',
      why: 'This reads the rate as the starting value. At t = 0 every term with a t in it vanishes, so what is left is the constant ' + b + ', not the coefficient.' },
    { v: 'The modelled quantity is ' + mag + ' when t = ' + b + '.',
      why: 'The two numbers in the model have been swapped into each other\'s roles. ' + m + ' is a rate per unit of t; ' + b + ' is a quantity at t = 0.' }
  ] : [
    { v: 'For each additional unit of t, the modelled quantity ' + dir + ' by ' + b + '.',
      why: 'This makes the starting value into a rate. ' + b + ' is where the model sits at t = 0; the per-unit change is the coefficient ' + m + '.' },
    { v: 'When t = 0, the modelled quantity is ' + m + '.',
      why: 'This is the coefficient of t. Setting t = 0 removes that whole term, leaving the constant ' + b + '.' },
    { v: 'The modelled quantity reaches ' + b + ' after one unit of t.',
      why: 'The constant is the value at t = 0, not at t = 1. After one unit the model has already changed by ' + m + '.' }
  ];

  return makeMC(rng, {
    section: 'math', domain: D_ALG, skill: 'linear-interpretation', qtype: 'alg-linfn-interpret', difficulty: diff,
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
    section: 'math', domain: D_ALG, skill: 'linear-inequality', qtype: 'alg-ineq-solve', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: dir === '≤' ? Math.ceil(thresholdRaw) : Math.floor(thresholdRaw), why: 'Rounded the wrong way.' },
      { v: -value, why: 'Flipped the sign.' },
      { v: value + (dir === '≤' ? 1 : -1), why: 'Off by one at the boundary.' },
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
      section: 'math', domain: D_ADV, skill: 'quadratic-roots', qtype: 'adv-nleq-quad-roots', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'quadratic-roots', qtype: 'adv-nleq-quad-roots', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: askGreater ? lesser : greater, why: 'This is the other root. Both are solutions; the question asked for the ' + (askGreater ? 'greater' : 'lesser') + ' one.' },
      { v: -value, why: 'Sign flipped. A factor of (x - ' + value + ') gives the root x = +' + value + ' - set the bracket to zero and solve it rather than reading the number straight off.' },
      { v: -(askGreater ? lesser : greater), why: 'The other root, with its sign flipped as well - both mistakes at once.' },
      { v: value + 1, why: 'One away from a root. Substitute it back into the equation and it will not give zero.' }
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
    section: 'math', domain: D_ADV, skill: 'quadratic-vieta', qtype: 'adv-nleq-quad-sumproduct', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: -value, why: 'Sign dropped. The sum of the roots is MINUS b/a, and the minus is easy to lose.' },
      { v: askSum ? r1 * r2 : r1 + r2, why: 'This is the ' + (askSum ? 'PRODUCT' : 'SUM') + ' of the roots. The question asked for the ' + (askSum ? 'sum' : 'product') + '.' },
      { v: askSum ? b : c, why: 'Read the coefficient straight off the equation. It has to be divided by a first - the relationships are -b/a and c/a, not -b and c.' },
      { v: value + a, why: 'The leading coefficient has been added in somewhere rather than divided by.' }
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
    section: 'math', domain: D_ADV, skill: 'quadratic-vertex', qtype: 'adv-nlfn-vertex', difficulty: diff,
    stem, correct: k,
    distractors: [
      { v: h, why: 'This is the x-coordinate of the vertex - WHERE the minimum or maximum happens, not the value there.' },
      { v: -k, why: 'Sign flipped. In a(x - h)² + k the constant k is added, so it is read off with its own sign.' },
      { v: -h, why: 'The x-coordinate of the vertex with its sign flipped. Two mistakes: wrong coordinate, wrong sign.' },
      { v: a, why: 'This is the leading coefficient. It decides whether the parabola opens up or down, not how high or low the vertex sits.' }
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
    section: 'math', domain: D_ADV, skill: 'discriminant', qtype: 'adv-nleq-discriminant', difficulty: diff,
    stem, correct,
    /* The reason states the discriminant's actual sign, so it teaches the test
       rather than just contradicting the choice. */
    distractors: ['Two', 'One', 'Zero', 'Infinitely many']
      .filter((s) => s !== correct)
      .map((s) => {
        if (s === 'Infinitely many') {
          return { v: s, why: 'A quadratic can have at most two solutions. Infinitely many would mean every value of x works, which only happens when the whole equation collapses to 0 = 0.' };
        }
        const sign = disc > 0 ? 'positive' : disc === 0 ? 'exactly zero' : 'negative';
        const need = s === 'Two' ? 'positive' : s === 'One' ? 'exactly zero' : 'negative';
        return { v: s, why: s + ' real solutions would need b² - 4ac to be ' + need +
                            '. Here it works out to ' + disc + ', which is ' + sign + '.' };
      }),
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
    section: 'math', domain: D_ADV, skill: 'exponential-model', qtype: 'adv-nlfn-exp-model', difficulty: diff,
    stem, correct,
    distractors: [
      { v: 'The initial value is ' + fmtCount(A0) + ', and it ' + antiDir + ' by ' + rPct + '% each ' + ctx.unit + '.',
        why: 'Right rate, wrong direction. A base of ' + fStr + ' is ' +
             (ctx.growth ? 'above 1, which means growth' : 'below 1, which means decay') + '.' },
      { v: 'The initial value is ' + fmtCount(A0) + ', and it ' + dir + ' by ' + (100 - rPct) + '% each ' + ctx.unit + '.',
        why: 'Read the base ' + fStr + ' as the percentage itself. The base is 1 ' +
             (ctx.growth ? 'PLUS' : 'MINUS') + ' the rate, so the rate is ' + rPct + '%, not ' + (100 - rPct) + '%.' },
      { v: 'The initial value is ' + fStr + ', and it ' + dir + ' by ' + fmtCount(A0) + '% each ' + ctx.unit + '.',
        why: 'The two numbers have swapped jobs. In A₀·bᵗ the coefficient out front is the starting amount and the base carries the rate.' }
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
      section: 'math', domain: D_ADV, skill: 'exponential-evaluate', qtype: 'adv-nlfn-exp-evaluate', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'exponential-evaluate', qtype: 'adv-nlfn-exp-evaluate', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: A0 * base * t, why: 'Multiplied by the exponent instead of raising to it. ' + base + 'ᵗ means ' + base + ' multiplied by itself ' + t + ' times, not ' + base + ' × ' + t + '.' },
      { v: Math.pow(A0 * base, t), why: 'Raised the coefficient to the power as well. Only the base carries the exponent; the ' + A0 + ' out front multiplies once at the end.' },
      { v: A0 * Math.pow(base, t - 1), why: 'One step short - this is the value at t = ' + (t - 1) + '.' },
      { v: value + A0, why: 'The starting amount has been added on at the end instead of multiplied in.' }
    ],
    explanation
  });
}

/* 5.6  Equivalent expressions: difference of squares and perfect squares. */
function equivalentExpression(rng, diff) {
  const kind = rng.pick(['diffSquares', 'expandBinomial', 'factorTrinomial']);
  /* One question type per branch: these are different tasks that a student
     can be individually good or bad at, so they are reported separately. */
  const QT = { diffSquares: 'adv-equiv-diffsquares', expandBinomial: 'adv-equiv-expand',
    factorTrinomial: 'adv-equiv-factor' };
  const qt = QT[kind];
  /* a starts at 2 deliberately: at a = 1 the "mishandled leading coefficient"
     distractor below collapses into the correct factorisation. */
  const a = rng.int(2, 6), b = rng.int(1, 11);

  if (kind === 'diffSquares') {
    const stem = 'Which expression is equivalent to ' + (a * a) + 'x² - ' + (b * b) + ' ?';
    return makeMC(rng, {
      section: 'math', domain: D_ADV, skill: 'equivalent-expressions', qtype: qt, difficulty: diff,
      stem,
      correct: '(' + term(a, 'x') + ' - ' + b + ')(' + term(a, 'x') + ' + ' + b + ')',
      distractors: [
        { v: '(' + term(a, 'x') + ' - ' + b + ')²', why: 'Treated it as a perfect square. Expand this and a middle x term appears; the original expression has none, which is the signal for a difference of squares.' },
        { v: '(' + term(a, 'x') + ' + ' + b + ')²', why: 'Same problem with the other sign - squaring a binomial always leaves a middle term, and there is none here.' },
        { v: '(' + term(a * a, 'x') + ' - ' + b + ')(x + ' + b + ')', why: 'The leading coefficient was not square-rooted. A² is ' + (a * a) + 'x², so A is ' + term(a, 'x') + ', not ' + term(a * a, 'x') + '.' },
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
      section: 'math', domain: D_ADV, skill: 'equivalent-expressions', qtype: qt, difficulty: diff,
      stem,
      correct: 'x²' + signedTerm(mid, 'x') + signed(last),
      distractors: [
        { v: 'x²' + signedTerm(last, 'x') + signed(mid), why: 'Swapped the middle and last terms.' },
        { v: 'x²' + signed(last), why: 'Forgot the cross terms entirely.' },
        { v: 'x²' + signedTerm(mid, 'x') + signed(-last), why: 'Sign error on the product.' },
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
    section: 'math', domain: D_ADV, skill: 'equivalent-expressions', qtype: qt, difficulty: diff,
    stem,
    correct: f(r1) + f(r2),
    distractors: [
      { v: f(-r1) + f(-r2), why: 'Both signs flipped.' },
      { v: f(r1) + f(-r2), why: 'One sign flipped.' },
      { v: f(r1 + r2) + '(x)', why: 'Split the middle coefficient instead of factoring.' },
    ],
    explanation: 'Look for two numbers multiplying to ' + last + ' and summing to ' + mid +
                 ': they are ' + (-r1) + ' and ' + (-r2) + '.'
  });
}

/* Exponent rules - a reliable, purely symbolic archetype. */
function exponentRules(rng, diff) {
  const a = rng.int(2, 9), m = rng.int(2, 7), n = rng.int(2, 7);
  const kind = rng.pick(['product', 'power', 'quotient', 'negative']);
  /* One question type per branch: these are different tasks that a student
     can be individually good or bad at, so they are reported separately. */
  const QT = { product: 'adv-equiv-exponent-product', power: 'adv-equiv-exponent-power',
    quotient: 'adv-equiv-exponent-quotient', negative: 'adv-equiv-exponent-negative' };
  const qt = QT[kind];

  let stem, correct, distractors, explanation;
  if (kind === 'product') {
    stem = 'Which expression is equivalent to (' + a + 'x^' + m + ')(x^' + n + ') ?';
    correct = a + 'x^' + (m + n);
    distractors = [
      { v: a + 'x^' + (m * n), why: 'Multiplied the exponents. Multiplying the powers adds them; multiplying the exponents is what happens when a power is RAISED to a power.' },
      { v: a + 'x^' + Math.abs(m - n), why: 'Subtracted the exponents. That is the rule for DIVIDING powers of the same base.' },
      { v: (a * a) + 'x^' + (m + n), why: 'The exponent is right, but the coefficient was squared. Only one of the two terms carries a coefficient, so it is unchanged.' }
    ];
    explanation = 'Multiplying powers of the same base adds the exponents: x^' + m + ' · x^' + n +
                  ' = x^' + (m + n) + '.';
  } else if (kind === 'power') {
    stem = 'Which expression is equivalent to (' + a + 'x^' + m + ')^' + n + ' ?';
    correct = Math.pow(a, n) + 'x^' + (m * n);
    distractors = [
      { v: a + 'x^' + (m * n), why: 'The exponent is right, but the coefficient was left alone. The outer power applies to EVERY factor inside the bracket, coefficient included.' },
      { v: Math.pow(a, n) + 'x^' + (m + n), why: 'Added the exponents. Adding is for multiplying two powers; raising a power to a power multiplies them.' },
      { v: (a * n) + 'x^' + (m * n), why: 'Multiplied the coefficient by the outer power instead of raising it to that power.' }
    ];
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
    distractors = [
      { v: 'x^' + (big + small), why: 'Added the exponents. Adding is for MULTIPLYING powers of the same base; dividing subtracts them.' },
      { v: 'x^' + (big * small), why: 'Multiplied the exponents. That is the rule for raising a power to a power.' },
      { v: 'x^' + small, why: 'Kept the bottom exponent. The top one has to have the bottom one subtracted from it.' }
    ];
    explanation = 'Dividing powers of the same base subtracts the exponents: ' + big + ' - ' +
                  small + ' = ' + (big - small) + '.';
  } else {
    stem = 'Which expression is equivalent to ' + a + 'x^(-' + m + ') ?';
    correct = a + '/x^' + m;
    distractors = [
      { v: '-' + a + 'x^' + m, why: 'Turned the negative exponent into a negative NUMBER. A negative exponent is about position - it moves the power across the fraction bar - not about sign.' },
      { v: '1/(' + a + 'x^' + m + ')', why: 'Sent the coefficient down with the power. The negative exponent belongs to x alone, so ' + a + ' stays on top.' },
      { v: '-' + a + '/x^' + m, why: 'Moved the power down correctly but also flipped the sign. Only one of those two things happens.' }
    ];
    explanation = 'A negative exponent moves the power to the denominator; the coefficient ' +
                  a + ' stays in the numerator.';
  }

  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'exponent-rules', qtype: qt, difficulty: diff,
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
      section: 'math', domain: D_ADV, skill: 'radical-equation', qtype: 'adv-nleq-radical', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'radical-equation', qtype: 'adv-nleq-radical', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: (k - c) / a, why: 'Subtracted ' + k + ' instead of squaring it. To undo a square root you square the OTHER side, so the right-hand side becomes ' + sq + '.' },
      { v: sq, why: 'Stopped after squaring. ' + sq + ' is what the expression under the root equals - there is still an equation left to solve for x.' },
      { v: -value, why: 'Sign flipped. Substitute it back under the root and check: the two sides will not match.' },
      { v: value + k, why: 'The number on the right of the equation has been added to the answer instead of being squared and used in the equation.' }
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
      section: 'math', domain: D_ADV, skill: 'function-notation', qtype: 'adv-nlfn-composite', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_ADV, skill: 'function-notation', qtype: 'adv-nlfn-composite', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: c * (a * x + b) + d, why: 'Composed the other way round. The inner function is evaluated first, and its OUTPUT is what goes into the outer one.' },
      { v: inner, why: 'Stopped halfway. This is the value of the inner function; it still has to be fed into the outer one.' },
      { v: a * x + b, why: 'Put x straight into the outer function, skipping the inner one entirely.' },
      { v: value + a, why: 'One coefficient has been added on at the end rather than used inside the composition.' }
    ],
    explanation
  });
}

/* There used to be a complexNumbers generator here, worth 2% of the Math
   section. It has been removed, because complex numbers are not tested on the
   digital SAT.

   That is not a judgement call. The strings "complex number" and "imaginary"
   appear zero times across all 227 pages of the College Board's Assessment
   Framework for the Digital SAT Suite, including Table A35, which is the
   complete list of Advanced Math testing points. The paper SAT did test i; the
   digital one dropped it along with the no-calculator section.

   Practising off-spec content is worse than not practising: it costs the
   student time and, because the game reported it as Advanced Math, it made the
   domain look covered when 2% of it was spent on something that cannot appear.
   The freed weight went to equivalent expressions, which is one of only three
   Advanced Math skills and is heavily tested. */

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
      section: 'math', domain: D_PSDA, skill: 'rates-proportions', qtype: 'psda-ratio-rate', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'rates-proportions', qtype: 'psda-ratio-rate', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: Math.round(a * b / c) || value + 3, why: 'The proportion is upside down. Check the units: the rate has to be written so the unwanted unit cancels.' },
      { v: Math.round(c / perUnit), why: 'Divided by the rate where multiplying was needed. Decide first whether the answer should come out larger or smaller than what you started with.' },
      { v: perUnit * c + a, why: 'The original amount has been added on again after the rate was applied.' },
      { v: a * c, why: 'Multiplied the two given numbers directly without first working out the rate per unit.' }
    ],
    explanation
  });
}

/* 5.9  Percentages, including the successive-change trap. */
function percentages(rng, diff) {
  const kind = rng.pick(['ofValue', 'change', 'successive', 'reverse']);
  /* One question type per branch: these are different tasks that a student
     can be individually good or bad at, so they are reported separately. */
  const QT = { ofValue: 'psda-pct-of', change: 'psda-pct-change',
    successive: 'psda-pct-successive', reverse: 'psda-pct-reverse' };
  const qt = QT[kind];

  if (kind === 'ofValue') {
    const pct = rng.pick([5, 8, 10, 12, 15, 20, 25, 30, 40, 60, 75]);
    const base = rng.int(4, 60) * 20;
    const value = base * pct / 100;
    const stem = 'What is ' + pct + '% of ' + fmtCount(base) + ' ?';
    return makeMC(rng, {
      section: 'math', domain: D_PSDA, skill: 'percentages', qtype: qt, difficulty: diff,
      stem, correct: value,
      distractors: [
        { v: base * pct / 10, why: 'Divided by 10 instead of 100. "Per cent" means per hundred, so the percentage always goes over 100.' },
        { v: base - value, why: 'This is what is LEFT after taking the percentage away, not the percentage itself.' },
        { v: base / pct, why: 'Divided by the percentage. Finding a percentage of something multiplies.' },
        { v: value * 2, why: 'Twice the right answer - the percentage was applied and then doubled.' }
      ],
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
      section: 'math', domain: D_PSDA, skill: 'percentages', qtype: qt, difficulty: diff,
      stem, correct: value,
      distractors: [
        { v: up ? base * (1 - pct / 100) : base * (1 + pct / 100), why: 'Moved the wrong way.' },
        { v: base * pct / 100, why: 'This is the SIZE of the change, not the new price. It still has to be ' + (up ? 'added to' : 'taken off') + ' the original.' },
        { v: base + pct, why: 'Added the percentage as if it were dollars. ' + pct + '% of ' + fmtMoney(base) + ' is ' + fmtNumber(base * pct / 100) + ', not ' + pct + '.' },
        { v: value + base * 0.01 * pct, why: 'The change has been applied twice.' }
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
      section: 'math', domain: D_PSDA, skill: 'percentages', qtype: qt, difficulty: diff,
      stem, correct: value,
      // The headline trap: adding the percentages instead of compounding them.
      distractors: [
        { v: base * (1 + (p1 - p2) / 100), why: 'Added the two percentages together and applied the result once. Percent changes compound - the second one acts on the already-changed amount, not on the original.' },
        { v: base, why: 'Assumes an increase of ' + p1 + '% and a decrease of ' + p2 + '% cancel out. They only would if the two acted on the same starting amount, and they do not.' },
        { v: base * (1 - p1 / 100) * (1 + p2 / 100), why: 'Applied the decrease first and the increase second. The order given in the question is the other way round.' },
        { v: value + base * 0.01, why: 'A one-percent slip on the base has crept in somewhere in the arithmetic.' }
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
    section: 'math', domain: D_PSDA, skill: 'percentages', qtype: qt, difficulty: diff,
    stem, correct: original,
    distractors: [
      { v: after * (1 - pct / 100), why: 'Took ' + pct + '% off the NEW value. The increase was ' + pct + '% of the ORIGINAL, which is a smaller amount, so this overshoots.' },
      { v: after - pct, why: 'Subtracted the percentage as if it were a plain quantity rather than a proportion of the original.' },
      { v: after / pct, why: 'Divided by ' + pct + ' instead of by ' + (1 + pct / 100).toFixed(2) + '. To undo a ' + pct + '% increase you divide by 1 plus the rate.' },
      { v: original + pct, why: 'Added the percentage number to the answer as if it were units.' }
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
    section: 'math', domain: D_PSDA, skill: 'unit-conversion', qtype: 'psda-ratio-units', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: v / c.k, why: 'Divided by the conversion factor instead of multiplying. Check the direction: one ' + c.from.replace(/s$/, '') + ' is MANY ' + c.to + ', so the number has to get bigger.' },
      { v: v + c.k, why: 'Added the conversion factor. A conversion scales the measurement; it does not add to it.' },
      { v: value * c.k, why: 'Multiplied by the factor twice. One conversion, one multiplication.' },
      { v: v * c.k / 10, why: 'The right method with a factor-of-ten slip in the arithmetic.' }
    ],
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
    section: 'math', domain: D_PSDA, skill: 'probability-table', qtype: 'psda-prob-table', difficulty: diff,
    stem, graphic,
    correct: fmtFraction(rn, rd),
    distractors: [
      { v: fmtFraction(num, total), why: 'Used the grand total as the denominator.' },
      { v: fmtFraction(den - num, den), why: 'Took the complement.' },
      { v: fmtFraction(den, num), why: 'Inverted the ratio.' },
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
    section: 'math', domain: D_PSDA, skill: 'statistics-center', qtype: 'psda-1var-center', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: which === 'median' ? Math.round(mean * 100) / 100 : median,
        why: 'This is the ' + (which === 'median' ? 'MEAN' : 'MEDIAN') + '. The question asked for the ' + which + ': ' +
             (which === 'median' ? 'the middle value once the list is in order' : 'the total divided by how many there are') + '.' },
      { v: range, why: 'This is the RANGE - the largest value minus the smallest. It measures spread, not centre.' },
      { v: data[n - 1], why: 'This is the largest value in the set, not a measure of its centre.' },
      { v: Math.round(mean * 100) / 100 + 1, why: 'One away from the mean - check the addition and the count of values.' }
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
    section: 'math', domain: D_PSDA, skill: 'statistics-spread', qtype: 'psda-1var-spread', difficulty: diff,
    stem,
    correct: 'The mean increases substantially, and the median changes only slightly.',
    distractors: [
      { v: 'The mean and the median both increase substantially.',
        why: 'The mean does move a long way, but the median does not. The median only cares where a value sits in the order, and one new value shifts that position by half a place - it does not matter how far out it is.' },
      { v: 'The median increases substantially, and the mean changes only slightly.',
        why: 'This has the two the wrong way round. The mean is the one built from every value, so it is the one an extreme value drags.' },
      { v: 'Neither the mean nor the median changes.',
        why: 'Adding a value well outside the existing range always moves the mean. Only the median is nearly immune.' }
    ],
    explanation: 'The mean uses every value, so a far-out point pulls it strongly. ' +
                 'The median depends only on position, so an extreme value shifts it at most one place.'
  });
}

/* 5.11b  Margin of error.

   The other half of the pair the taxonomy declared and nothing produced. The
   real test asks two things about a margin of error: what interval it implies,
   and what would make it narrower. Both are here. */
const MOE_CONTEXTS = [
  { who: 'residents of a city', what: 'mean commute time', unit: 'minutes' },
  { who: 'students at a university', what: 'mean hours of sleep on a weeknight', unit: 'hours' },
  { who: 'adult visitors to a park', what: 'mean length of visit', unit: 'minutes' },
  { who: 'households in a county', what: 'mean monthly water use', unit: 'cubic metres' }
];

function marginOfError(rng, diff) {
  const ctx = rng.pick(MOE_CONTEXTS);
  const n = rng.pick([200, 250, 400, 500, 800, 1000]);
  const mean = rng.int(12, 80);
  const moe = rng.pick([1, 2, 3, 4, 5]);
  const lo = mean - moe, hi = mean + moe;
  const askNarrow = rng.bool(0.35);

  const setup = 'A random sample of ' + fmtCount(n) + ' ' + ctx.who + ' was surveyed. ' +
                'The sample had a ' + ctx.what + ' of ' + mean + ' ' + ctx.unit +
                ', with an associated margin of error of ' + moe + ' ' + ctx.unit + '.';

  if (askNarrow) {
    return makeMC(rng, {
      section: 'math', domain: D_PSDA, skill: 'inference-margin-of-error',
      qtype: 'psda-infer-moe', difficulty: diff,
      stem: setup + '\n\nWhich change to the study would be most likely to decrease the margin of error?',
      correct: 'Surveying a larger random sample of ' + ctx.who + '.',
      distractors: [
        { v: 'Surveying a smaller random sample of ' + ctx.who + '.',
          why: 'Backwards. A smaller sample carries LESS information, so the interval around the estimate gets wider, not narrower.' },
        { v: 'Surveying the same number of ' + ctx.who + ' on a different day.',
          why: 'This changes which people are in the sample but not how many. Margin of error is driven by sample size, not by when the sample was taken.' },
        { v: 'Reporting the median instead of the mean.',
          why: 'Choosing a different statistic to report does not change how much sampling error there is in the estimate.' }
      ],
      explanation: 'Margin of error shrinks as the sample grows - it falls with the square root of ' +
                   'the sample size, so quadrupling the sample halves the margin.'
    });
  }

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'inference-margin-of-error',
    qtype: 'psda-infer-moe', difficulty: diff,
    stem: setup + '\n\nWhich conclusion is most appropriate?',
    correct: 'It is plausible that the ' + ctx.what + ' for all ' + ctx.who +
             ' is between ' + lo + ' and ' + hi + ' ' + ctx.unit + '.',
    distractors: [
      { v: 'Every one of the ' + ctx.who + ' surveyed reported between ' + lo + ' and ' + hi + ' ' + ctx.unit + '.',
        why: 'The interval is about the AVERAGE for the whole population, not about individuals. Individual values scatter far more widely than the mean does.' },
      { v: 'The ' + ctx.what + ' for all ' + ctx.who + ' is exactly ' + mean + ' ' + ctx.unit + '.',
        why: 'That is the sample mean. The whole point of a margin of error is that the population value is not known exactly - if it were, no interval would be needed.' },
      { v: 'At least ' + fmtCount(n) + ' of the ' + ctx.who + ' have a ' + ctx.what +
           ' of at least ' + lo + ' ' + ctx.unit + '.',
        why: 'This turns an estimate about a population average into a count of individuals, which the survey gives no basis for.' }
    ],
    explanation: 'The margin of error gives a plausible range for the POPULATION mean: ' +
                 mean + ' ± ' + moe + ', so ' + lo + ' to ' + hi + ' ' + ctx.unit +
                 '. It describes the average, not any individual.'
  });
}

/* 5.11c  Study design - what a study of this shape actually licenses. */
const STUDY_CONTEXTS = [
  { subj: 'a daily walk', outcome: 'lower reported stress', group: 'office workers' },
  { subj: 'a music lesson each week', outcome: 'higher test scores', group: 'secondary students' },
  { subj: 'a standing desk', outcome: 'less back pain', group: 'call centre staff' },
  { subj: 'a morning reading habit', outcome: 'better recall', group: 'volunteers over sixty' }
];

function studyDesign(rng, diff) {
  const c = rng.pick(STUDY_CONTEXTS);
  const randomised = rng.bool();
  const n = rng.pick([80, 120, 200, 350]);

  const stem = randomised
    ? fmtCount(n) + ' ' + c.group + ' volunteered for a study and were RANDOMLY assigned either ' +
      'to take up ' + c.subj + ' or to carry on as usual. After six months the group with ' +
      c.subj + ' showed ' + c.outcome + '.\n\nWhat is the most appropriate conclusion?'
    : fmtCount(n) + ' ' + c.group + ' were surveyed. Those who already had ' + c.subj +
      ' reported ' + c.outcome + ' than those who did not.' +
      '\n\nWhat is the most appropriate conclusion?';

  /* The two axes the real test tests: whether the design supports CAUSE, and
     who the conclusion may be extended to. A randomised assignment buys cause;
     volunteering restricts the population either way. */
  const correct = randomised
    ? c.subj.charAt(0).toUpperCase() + c.subj.slice(1) + ' likely causes ' + c.outcome +
      ' in ' + c.group + ' similar to the volunteers.'
    : 'There is an association between ' + c.subj + ' and ' + c.outcome +
      ', but no cause can be established.';

  return makeMC(rng, {
    section: 'math', domain: D_PSDA, skill: 'evaluating-claims',
    qtype: 'psda-claims-design', difficulty: diff,
    stem, correct,
    distractors: randomised ? [
      { v: 'There is an association between ' + c.subj + ' and ' + c.outcome + ', but no cause can be established.',
        why: 'Too cautious. Subjects were assigned at RANDOM, which is exactly what licenses a causal conclusion - random assignment is what evens out the other differences between the groups.' },
      { v: c.subj.charAt(0).toUpperCase() + c.subj.slice(1) + ' causes ' + c.outcome + ' in all adults.',
        why: 'Too broad. The subjects were ' + c.group + ' who volunteered, so the conclusion extends to people like them - not to adults in general.' },
      { v: 'No conclusion can be drawn, because the subjects were volunteers.',
        why: 'Volunteering limits WHO the result applies to; it does not destroy the study. Random assignment within the volunteers still supports a causal claim about that group.' }
    ] : [
      { v: c.subj.charAt(0).toUpperCase() + c.subj.slice(1) + ' causes ' + c.outcome + ' in ' + c.group + '.',
        why: 'Nobody was assigned to anything - the subjects already had or did not have ' + c.subj + '. Something else could easily explain both, so this design cannot establish cause.' },
      { v: 'Adopting ' + c.subj + ' would produce ' + c.outcome + ' in anyone.',
        why: 'Two problems at once: it claims cause from an observational study, and it extends the claim well beyond the group that was actually surveyed.' },
      { v: 'No relationship exists between ' + c.subj + ' and ' + c.outcome + '.',
        why: 'A difference WAS observed. What the study cannot say is why - which is not the same as saying there is nothing there.' }
    ],
    explanation: randomised
      ? 'Random ASSIGNMENT is what supports a causal conclusion. Random SELECTION is what ' +
        'supports generalising to a wider population - and these subjects volunteered, so the ' +
        'conclusion stays with people like them.'
      : 'This is an observational study: the subjects sorted themselves. It can establish an ' +
        'association, but a third factor could explain both, so it cannot establish cause.'
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
    section: 'math', domain: D_PSDA, skill: 'scatter-model', qtype: 'psda-2var-scatter', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: m * x, why: 'Left off the starting value of ' + b + '. That is where the model begins at week zero, so it is part of every prediction.' },
      { v: b + x, why: 'Added the number of weeks to the starting value without multiplying by the rate of ' + m + ' per week.' },
      { v: m + b + x, why: 'Added all three numbers. The rate has to MULTIPLY the number of weeks, not join the sum.' },
      { v: value + m, why: 'One week too many - this is the prediction for week ' + (x + 1) + '.' }
    ],
    explanation: 'Substitute x = ' + x + ': y = ' + m + '(' + x + ') + ' + b + ' = ' + value + '.'
  });
}

/* ================================================ GEOMETRY & TRIGONOMETRY */

/* 5.13  Area and volume, solved for a missing dimension so it stays clean. */
function areaVolume(rng, diff) {
  const kind = rng.pick(['rectArea', 'triArea', 'boxVolume', 'cylVolume', 'circleArea']);
  /* One question type per branch: these are different tasks that a student
     can be individually good or bad at, so they are reported separately. */
  const QT = { rectArea: 'geo-areavol-rect', triArea: 'geo-areavol-tri',
    boxVolume: 'geo-areavol-box', cylVolume: 'geo-areavol-cyl',
    circleArea: 'geo-areavol-circle' };
  const qt = QT[kind];

  if (kind === 'rectArea') {
    const w = rng.int(3, 20), h = rng.int(3, 20);
    const area = w * h;
    const stem = 'A rectangle has an area of ' + area + ' square centimetres and a width of ' +
                 w + ' centimetres.\n\nWhat is its length, in centimetres?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', qtype: qt, difficulty: diff,
      stem, correct: h,
      distractors: [
        { v: area - w, why: 'Subtracted the width from the area. Area is a product, so recovering a side means dividing, not subtracting.' },
        { v: area / 2, why: 'Halved the area. That is the triangle formula; a rectangle has no ½ in it.' },
        { v: 2 * (w + h), why: 'This is the perimeter, the distance around the outside, not a single side.' },
        { v: w, why: 'This is the width you were given back again, not the length you were asked for.' }
      ],
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
      section: 'math', domain: D_GEO, skill: 'area-volume', qtype: qt, difficulty: diff,
      stem, correct: area,
      distractors: [
        { v: base * height, why: 'Left out the ½. Base × height is the area of the RECTANGLE that encloses this triangle, which is exactly twice as big.' },
        { v: base + height, why: 'Added the two lengths instead of multiplying them. Area is always a product of two lengths.' },
        { v: area / 2, why: 'Halved once too often - the ½ has been applied twice.' },
        { v: base * height * 2, why: 'Doubled where the formula halves.' }
      ],
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
      section: 'math', domain: D_GEO, skill: 'area-volume', qtype: qt, difficulty: diff,
      stem, correct: h,
      distractors: [
        { v: vol / l, why: 'Divided by the length only. Volume is length × width × height, so both of the known sides have to come out.' },
        { v: vol / w, why: 'Divided by the width only. The length still has to be divided out as well.' },
        { v: l * w, why: 'This is the area of the base, not the height standing on it.' },
        { v: vol - l * w, why: 'Subtracted the base area from the volume. The three sides multiply, so undoing them means dividing.' }
      ],
      explanation: 'Height = volume ÷ (length × width) = ' + vol + ' ÷ ' + (l * w) + ' = ' + h + '.'
    });
  }

  if (kind === 'cylVolume') {
    const r = rng.int(2, 9), h = rng.int(2, 14);
    const coef = r * r * h;
    const stem = 'A right circular cylinder has radius ' + r + ' and height ' + h + '.' +
                 '\n\nWhat is its volume, in terms of π ?';
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'area-volume', qtype: qt, difficulty: diff,
      stem, correct: coef + 'π',
      distractors: [
        { v: (2 * r * h) + 'π', why: 'Used the lateral-surface formula.' },
        { v: (r * h) + 'π', why: 'Forgot to square the radius.' },
        { v: (r * r * h * 3) + 'π', why: 'Multiplied by 3 instead of using πr²h.' },
      ],
      explanation: 'V = πr²h = π(' + r + ')²(' + h + ') = ' + coef + 'π.'
    });
  }

  // r starts at 3: at r = 2, r² equals 2r and the circumference distractor
  // would be the correct area.
  const r = rng.int(3, 15);
  const stem = 'A circle has a radius of ' + r + '.\n\nWhat is its area, in terms of π ?';
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'area-volume', qtype: qt, difficulty: diff,
    stem, correct: (r * r) + 'π',
    distractors: [
      { v: (2 * r) + 'π', why: 'This is the CIRCUMFERENCE, 2πr - the distance around the edge, not the space inside.' },
      { v: r + 'π', why: 'Forgot to square the radius. The formula is πr², not πr.' },
      { v: (4 * r * r) + 'π', why: 'Squared the DIAMETER instead of the radius, which makes the answer four times too big.' }
    ],
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
        section: 'math', domain: D_GEO, skill: 'circle-equation', qtype: 'geo-circle-equation', difficulty: diff,
        stem, value: r, explanation
      });
    }
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'circle-equation', qtype: 'geo-circle-equation', difficulty: diff,
      stem, correct: r,
      // r² for r is the signature trap here.
      distractors: [
        { v: r * r, why: 'This is r², the number the equation actually shows. The radius is its square root, so one more step was needed.' },
        { v: Math.abs(F), why: 'This is the loose constant from the general form. It only becomes r² after the squares have been completed on both variables.' },
        { v: 2 * r, why: 'This is the DIAMETER, twice the radius.' }
      ],
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
    section: 'math', domain: D_GEO, skill: 'circle-equation', qtype: 'geo-circle-equation', difficulty: diff,
    stem,
    correct: '(x' + sx + ')² + (y' + sy + ')² = ' + (r * r),
    distractors: [
      { v: '(x' + sx + ')² + (y' + sy + ')² = ' + r, why: 'The centre is right, but the right-hand side is r rather than r². Standard form always ends in the radius SQUARED.' },
      { v: '(x' + fx + ')² + (y' + fy + ')² = ' + (r * r), why: 'The signs of the centre are flipped. The form is (x - h)², so a centre at ' + h + ' appears as a MINUS ' + h + ' inside the bracket.' },
      { v: '(x' + fx + ')² + (y' + fy + ')² = ' + r, why: 'Both mistakes at once - the centre signs are flipped and the radius was not squared.' }
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
      section: 'math', domain: D_GEO, skill: 'circle-arc', qtype: 'geo-circle-arc', difficulty: diff,
      stem: 'A circle has radius ' + r + '. An arc of the circle has a central angle of ' + deg +
            ' degrees.\n\nWhat is the length of the arc, in terms of π ?',
      correct,
      distractors: [
        { v: piFrac(deg * r * r, 360), why: 'Used the sector-area formula.' },
        { v: piFrac(deg * r, 360), why: 'Dropped the factor of 2.' },
        { v: piFrac(2 * r, 1), why: 'Gave the whole circumference.' },
      ],
      explanation: 'Arc length = (θ/360) × 2πr = (' + deg + '/360) × 2π(' + r + ') = ' + correct + '.'
    });
  }

  const correct = piFrac(deg * r * r, 360);
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'circle-sector', qtype: 'geo-circle-sector', difficulty: diff,
    stem: 'A circle has radius ' + r + '. A sector of the circle has a central angle of ' + deg +
          ' degrees.\n\nWhat is the area of the sector, in terms of π ?',
    correct,
    distractors: [
      { v: piFrac(deg * 2 * r, 360), why: 'Arc length instead.' },
      { v: piFrac(deg * r, 360), why: 'Used r rather than r².' },
      { v: piFrac(r * r, 1), why: 'Gave the whole circle.' },
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
      section: 'math', domain: D_GEO, skill: 'radians', qtype: 'geo-circle-radians', difficulty: diff,
      stem: 'An angle measures ' + piFrac(num, den) + ' radians.' +
            '\n\nWhat is the measure of the angle, in degrees?',
      correct: deg,
      distractors: [
        { v: deg / 2, why: 'Half the right answer. Converting radians to degrees multiplies by 180/π - using 90 instead of 180 halves everything.' },
        { v: deg * 2, why: 'Twice the right answer. 360/π has been used where the conversion factor is 180/π.' },
        { v: 360 - deg, why: 'This is the reflex angle that completes a full turn, not the angle itself.' },
        { v: 180 - deg, why: 'This is the supplement of the angle, not the angle.' }
      ],
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
  for (const c of [
    { v: piFrac(rd, rn), why: 'The fraction is upside down. Converting degrees to radians multiplies by π/180, so ' + deg + '/180 reduces to ' + correct + '.' },
    { v: piFrac(rn, rd * 2), why: 'Half the right measure - a factor of 2 has been introduced in the denominator.' },
    { v: piFrac(rn * 2, rd), why: 'Twice the right measure. Check against the landmarks: 180 degrees is π, and 360 is 2π.' },
    { v: piFrac(rn * 3, rd), why: 'Three times the right measure. Check against the landmarks: 180 degrees is π radians.' },
    { v: piFrac(rn, rd * 3), why: 'A third of the right measure - an extra 3 has crept into the denominator.' },
    { v: piFrac(rn + 1, rd), why: 'The denominator is right but the numerator is one too many; reduce ' + deg + '/180 carefully.' }
  ]) {
    if (c.v !== correct && !cands.some((x) => x.v === c.v)) cands.push(c);
  }

  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'radians', qtype: 'geo-circle-radians', difficulty: diff,
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
        section: 'math', domain: D_GEO, skill: 'right-triangle', qtype: 'geo-right-pythagorean', difficulty: diff,
        stem, value, explanation
      });
    }
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'right-triangle', qtype: 'geo-right-pythagorean', difficulty: diff,
      stem, correct: value,
      distractors: [
        { v: findHyp ? legA + legB : hyp - legA, why: 'Added or subtracted the sides directly. Pythagoras works on the SQUARES of the sides, and squares do not add like lengths do.' },
        { v: findHyp ? legA * legA + legB * legB : hyp * hyp - legA * legA, why: 'This is the square of the answer. The square root is still to be taken.' },
        { v: value + 1, why: 'One too many. Square all three sides and check that the two smaller squares add to the largest.' },
        { v: value - 1, why: 'One too few. Square all three sides and check that the two smaller squares add to the largest.' }
      ],
      explanation
    });
  }

  if (kind === 'identity') {
    const sinT = fmtFraction(legA, hyp);
    const cosT = fmtFraction(legB, hyp);
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'pythagorean-identity', qtype: 'geo-right-trig-complementary', difficulty: diff,
      stem: 'In a right triangle, θ is an acute angle and sin(θ) = ' + sinT + '.' +
            '\n\nWhat is the value of cos(θ) ?',
      correct: cosT,
      distractors: [
        { v: sinT, why: 'Repeated the given value.' },
        { v: fmtFraction(hyp, legB), why: 'Reciprocal (secant).' },
        { v: fmtFraction(legA, legB), why: 'Gave the tangent instead.' },
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
    section: 'math', domain: D_GEO, skill: 'right-triangle-trig', qtype: 'geo-right-trig-ratio', difficulty: diff,
    stem: 'In right triangle ABC, the right angle is at C. Side BC measures ' + legA +
          ', side AC measures ' + legB + ', and the hypotenuse AB measures ' + hyp + '.' +
          '\n\nWhat is the value of ' + fn + '(' + angle + ') ?',
    correct,
    distractors: [
      { v: fn === 'sin' ? fmtFraction(adj, hyp) : fn === 'cos' ? fmtFraction(opp, hyp) : fmtFraction(adj, opp),
        why: fn === 'tan'
          ? 'Adjacent over opposite - the tangent ratio upside down. TOA is Tangent = Opposite over Adjacent.'
          : 'This is ' + (fn === 'sin' ? 'cos' : 'sin') + '(' + angle + '). The opposite and adjacent sides have been swapped: SOH is sine = opposite/hypotenuse, CAH is cosine = adjacent/hypotenuse.' },
      { v: fn === 'tan' ? fmtFraction(opp, hyp) : fmtFraction(hyp, fn === 'sin' ? opp : adj),
        why: fn === 'tan'
          ? 'Divided by the hypotenuse. Tangent is the one ratio that does not use the hypotenuse at all.'
          : 'The fraction is upside down. The hypotenuse goes on the BOTTOM for both sine and cosine, which is why neither can ever exceed 1.' },
      { v: fmtFraction(opp, adj) === correct ? fmtFraction(hyp, adj) : fmtFraction(opp, adj),
        why: 'A ratio of two real sides of this triangle, but not the pair that ' + fn + ' asks for. Label the sides opposite, adjacent and hypotenuse relative to angle ' + angle + ' first, then pick.' }
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
      section: 'math', domain: D_GEO, skill: 'similar-triangles', qtype: 'geo-lines-similar', difficulty: diff,
      stem, value, explanation
    });
  }
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'similar-triangles', qtype: 'geo-lines-similar', difficulty: diff,
    stem, correct: value,
    distractors: [
      { v: sides[missing], why: 'Forgot to scale at all.' },
      { v: sides[missing] * scale * scale, why: 'Applied the area scale factor.' },
      { v: sides[missing] + scale, why: 'Added instead of multiplied.' },
      value + scale
    ],
    explanation
  });
}

/* Angles: parallel lines and triangle sums. */
function angleRelationships(rng, diff) {
  const kind = rng.pick(['triangleSum', 'parallelLines', 'exterior']);
  /* One question type per branch: these are different tasks that a student
     can be individually good or bad at, so they are reported separately. */
  const QT = { triangleSum: 'geo-lines-trianglesum', parallelLines: 'geo-lines-parallel',
    exterior: 'geo-lines-exterior' };
  const qt = QT[kind];

  if (kind === 'triangleSum') {
    const a = rng.int(25, 85), b = rng.int(25, 85);
    const c = 180 - a - b;
    if (c < 15) return angleRelationships(rng, diff);
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'angles', qtype: qt, difficulty: diff,
      stem: 'In triangle ABC, the measure of angle A is ' + a + ' degrees and the measure of ' +
            'angle B is ' + b + ' degrees.\n\nWhat is the measure of angle C, in degrees?',
      correct: c,
      distractors: [
        { v: 180 - a, why: 'Subtracted only angle A. Both of the given angles have to come off the 180.' },
        { v: 180 - b, why: 'Subtracted only angle B. Angle A still has to come off as well.' },
        { v: a + b, why: 'This is the sum of the two given angles. It is the EXTERIOR angle at C, not the interior one.' },
        { v: 360 - a - b, why: 'Started from 360. A triangle sums to 180; 360 is a quadrilateral or a full turn.' }
      ],
      explanation: 'The angles of a triangle sum to 180 degrees: 180 - ' + a + ' - ' + b + ' = ' + c + '.'
    });
  }

  if (kind === 'parallelLines') {
    const a = rng.int(30, 150);
    const askSupplement = rng.bool();
    const value = askSupplement ? 180 - a : a;
    return makeMC(rng, {
      section: 'math', domain: D_GEO, skill: 'angles', qtype: qt, difficulty: diff,
      stem: 'Two parallel lines are cut by a transversal. One of the eight angles formed ' +
            'measures ' + a + ' degrees.\n\nWhat is the measure, in degrees, of an angle that is ' +
            (askSupplement ? 'supplementary to' : 'vertical to') + ' this angle?',
      correct: value,
      distractors: [
        { v: askSupplement ? a : 180 - a,
          why: askSupplement
            ? 'This is the original angle. Supplementary means the two ADD to 180, so it is 180 minus this one.'
            : 'This is the supplement. Vertical angles are equal to each other, not supplementary.' },
        { v: 90 - a, why: 'Used 90. That is the COMPLEMENT; nothing here says the angles are complementary.' },
        { v: 360 - a, why: 'Used a full turn. Angles on a straight line make 180, not 360.' },
        { v: a / 2, why: 'Halved the angle. Neither a vertical nor a supplementary relationship halves anything.' }
      ],
      explanation: askSupplement
        ? 'Supplementary angles sum to 180 degrees: 180 - ' + a + ' = ' + (180 - a) + '.'
        : 'Vertical angles are congruent, so the measure is also ' + a + ' degrees.'
    });
  }

  const a = rng.int(30, 80), b = rng.int(30, 80);
  const ext = a + b;
  return makeMC(rng, {
    section: 'math', domain: D_GEO, skill: 'angles', qtype: qt, difficulty: diff,
    stem: 'In triangle ABC, the measures of angles A and B are ' + a + ' degrees and ' + b +
          ' degrees.\n\nWhat is the measure, in degrees, of the exterior angle at vertex C?',
    correct: ext,
    distractors: [
      { v: 180 - ext, why: 'This is the INTERIOR angle at C. The exterior angle is its supplement, and equals the other two interior angles added together.' },
      { v: 180 - a - b, why: 'Same value by a different route - this is the interior angle at C, not the exterior one.' },
      { v: 360 - ext, why: 'Started from a full turn. The exterior angle theorem uses the two remote interior angles directly.' },
      { v: ext / 2, why: 'Halved the sum. The exterior angle equals the full sum of the two remote interior angles.' }
    ],
    explanation: 'An exterior angle equals the sum of the two remote interior angles: ' +
                 a + ' + ' + b + ' = ' + ext + '.'
  });
}

/* =========================================================== registry */

/* Weights reproduce the real domain split: 35 / 35 / 15 / 15. */
/* The College Board publishes the Math domain split as Algebra 35%, Advanced
   Math 35%, Problem-Solving and Data Analysis 15%, Geometry and Trigonometry
   15%.

   The section headings below already said exactly that. The weights under them
   did not: Advanced Math summed to 43 and Geometry to 25 against targets of 35
   and 15, so over 1500 generated questions the real mix came out Advanced 36%,
   Algebra 27%, Geometry 21%, Data 16%. Algebra - the single largest domain on
   the real test - was the one being short-changed.

   Every weight is now a direct percentage, each domain sums to its published
   share, and the totals are checked at load rather than asserted in a comment. */

const GENERATORS = [
  /* Algebra - 35. The four new entries below do not raise any domain's share;
     weight was taken from the largest generators in the same domain, because
     the published split is the thing that must not move. */
  { w: 7, d: D_ALG, fn: linearOneVar },
  { w: 7, d: D_ALG, fn: linearSystem },
  { w: 4, d: D_ALG, fn: linearFunctionValue },
  { w: 4, d: D_ALG, fn: linearInterpretation },
  { w: 4, d: D_ALG, fn: linearInequality },
  { w: 3, d: D_ALG, fn: systemSolutionCount },
  { w: 3, d: D_ALG, fn: linearSolutionCount },
  { w: 3, d: D_ALG, fn: writeLineEquation },

  /* Advanced Math - 35. functionNotation is filed here, not under Algebra
     where it used to sit: it asks for f(g(x)), and composite function notation
     belongs to Advanced Math's "nonlinear functions" strand rather than
     Algebra's "linear functions". The generator had always stamped its
     questions D_ADV; only the registry disagreed, and since the registry was
     the thing being audited, the audit reported the mix as correct while
     Algebra ran three points light. */
  { w: 5, d: D_ADV, fn: quadraticFactor },
  { w: 3, d: D_ADV, fn: quadraticVieta },
  { w: 4, d: D_ADV, fn: vertexForm },
  { w: 3, d: D_ADV, fn: discriminant },
  { w: 3, d: D_ADV, fn: exponentialModel },
  { w: 2, d: D_ADV, fn: exponentialEvaluate },
  { w: 6, d: D_ADV, fn: equivalentExpression },
  { w: 3, d: D_ADV, fn: exponentRules },
  { w: 3, d: D_ADV, fn: radicalEquation },
  { w: 3, d: D_ADV, fn: functionNotation },

  // Problem-Solving and Data Analysis - 15
  { w: 2, d: D_PSDA, fn: ratesProportion },
  { w: 3, d: D_PSDA, fn: percentages },
  { w: 2, d: D_PSDA, fn: twoWayTable },
  { w: 2, d: D_PSDA, fn: statisticsCenter },
  { w: 1, d: D_PSDA, fn: statisticsEffect },
  { w: 1, d: D_PSDA, fn: scatterModel },
  { w: 1, d: D_PSDA, fn: unitConversion },
  { w: 2, d: D_PSDA, fn: marginOfError },
  { w: 1, d: D_PSDA, fn: studyDesign },

  // Geometry and Trigonometry - 15
  { w: 3, d: D_GEO, fn: areaVolume },
  { w: 2, d: D_GEO, fn: circleEquation },
  { w: 2, d: D_GEO, fn: circleSector },
  { w: 1, d: D_GEO, fn: radianConversion },
  { w: 3, d: D_GEO, fn: rightTriangleTrig },
  { w: 2, d: D_GEO, fn: similarTriangles },
  { w: 2, d: D_GEO, fn: angleRelationships }
];

const MATH_DOMAIN_TARGET = {
  [D_ALG]: 35, [D_ADV]: 35, [D_PSDA]: 15, [D_GEO]: 15
};

(function verifyWeights() {
  const got = {};
  let total = 0;
  for (const g of GENERATORS) { got[g.d] = (got[g.d] || 0) + g.w; total += g.w; }
  const bad = [];
  if (total !== 100) bad.push('weights sum to ' + total + ', not 100');
  for (const k of Object.keys(MATH_DOMAIN_TARGET)) {
    if (got[k] !== MATH_DOMAIN_TARGET[k]) {
      bad.push(k + ' is ' + (got[k] || 0) + '%, published share is ' + MATH_DOMAIN_TARGET[k] + '%');
    }
  }
  if (bad.length) console.warn('[sat] Math domain mix is off spec: ' + bad.join('; '));
})();

function generate(rng, difficulty) {
  return SATG.satUtil.generateFrom(rng, GENERATORS, {
    difficulty: difficulty, bank: 'math', fallback: linearOneVar
  });
}

/* Same draw, restricted to one content domain - what a module test needs to
   hit the published domain quota exactly rather than on average. */
function generateInDomain(rng, difficulty, domain) {
  return SATG.satUtil.generateFrom(rng, GENERATORS, {
    difficulty: difficulty, domain: domain, bank: 'math', fallback: linearOneVar
  });
}

SATG.mathQuestions = {
  generate, generateInDomain, GENERATORS, MATH_DOMAIN_TARGET,
  domains: { D_ALG, D_ADV, D_PSDA, D_GEO }
};

})(window);
