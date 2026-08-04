/* =========================================================================
   sat/verbal-questions.js - the Reading & Writing generators.

   The research is explicit that R&W splits into three engineering tiers, and
   this file respects that split rather than pretending one approach covers
   everything:

     1. Fully parameterisable   Boundaries, Form/Structure/Sense, Transitions.
                                These are sentence-grammar transformations, so
                                they are driven off a bank of neutral factual
                                clauses and the punctuation/word options are
                                generated around fixed content.

     2. Template + content bank Words in Context, Rhetorical Synthesis. The
                                shape is generated; the vocabulary and the
                                fact-sets are authored.

     3. Authored outright       Central Ideas, Inferences, Text Structure,
                                Command of Evidence, Cross-Text. Reading
                                comprehension of real prose cannot be soundly
                                synthesised from templates - the failure mode
                                is passages that parse but do not cohere.

   Every distractor is built from a named R&W trap: too extreme, right idea
   with wrong scope, true but irrelevant, contradicts the passage, or wrong
   logical-relationship family.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { makeMC } = SATG.satUtil;

const D_CRAFT = 'Craft and Structure';
const D_INFO  = 'Information and Ideas';
const D_CONV  = 'Standard English Conventions';
const D_EXPR  = 'Expression of Ideas';

const STEM_CONVENTIONS =
  'Which choice completes the text so that it conforms to the conventions of Standard English?';

/* =========================================================================
   1. TRANSITIONS  (fully parameterised)

   Each entry is a genuine pair of sentences plus the true logical relation
   between them. The generator supplies one transition from the correct
   family and three from three *different* families, so exactly one fits.
   ========================================================================= */

const TRANSITION_FAMILIES = {
  contrast:  ['However,', 'Nevertheless,', 'Still,', 'In contrast,', 'Nonetheless,', 'By contrast,'],
  cause:     ['Therefore,', 'Consequently,', 'As a result,', 'Thus,', 'Accordingly,'],
  addition:  ['Furthermore,', 'Moreover,', 'Additionally,', 'Similarly,', 'In addition,'],
  example:   ['For example,', 'Specifically,', 'Indeed,', 'In fact,', 'For instance,']
};

const TRANSITION_PAIRS = [
  { a: 'The mineral was long assumed to form only under extreme pressure deep within the mantle.',
    b: 'in 2019 researchers identified a sample that had crystallised near the surface.', rel: 'contrast' },
  { a: 'Cold water holds dissolved oxygen more readily than warm water does.',
    b: 'fish in warming rivers face increasing respiratory stress.', rel: 'cause' },
  { a: 'The archive holds more than four thousand letters written by the composer.',
    b: 'it contains the only surviving draft of her final symphony.', rel: 'addition' },
  { a: 'Some desert plants have adapted to survive extended drought.',
    b: 'the creosote bush can suspend growth for years and resume after a single rainfall.', rel: 'example' },
  { a: 'Early telescopes suffered from severe chromatic distortion.',
    b: 'astronomers of the period still produced remarkably accurate lunar maps.', rel: 'contrast' },
  { a: 'The bridge was built with a hollow steel deck to reduce its total weight.',
    b: 'engineers were able to span a far greater distance than earlier designs allowed.', rel: 'cause' },
  { a: 'Kelp forests shelter hundreds of fish species along the coastline.',
    b: 'they absorb a substantial quantity of dissolved carbon.', rel: 'addition' },
  { a: 'Several early photographic processes required exposures lasting many minutes.',
    b: 'the daguerreotype initially demanded that a portrait sitter remain still for over ten minutes.', rel: 'example' },
  { a: 'The survey found that most residents supported the proposed transit line.',
    b: 'turnout at the subsequent public hearing was unusually low.', rel: 'contrast' },
  { a: 'The alloy contracts sharply as it cools below its transition temperature.',
    b: 'components machined at room temperature must be cut slightly oversized.', rel: 'cause' },
  { a: 'The manuscript was written in an unfamiliar shorthand.',
    b: 'the pages had been bound out of order at some point in the nineteenth century.', rel: 'addition' },
  { a: 'Certain bird species navigate using the Earth\'s magnetic field.',
    b: 'the European robin appears to detect field direction through a protein in its retina.', rel: 'example' },
  { a: 'The excavation recovered thousands of pottery fragments from the site.',
    b: 'almost none of them could be matched to a known regional workshop.', rel: 'contrast' },
  { a: 'The species reproduces only once every seventeen years.',
    b: 'a single poorly timed cold season can affect an entire generation.', rel: 'cause' },
  { a: 'The new spectrometer resolves wavelengths four times more finely than its predecessor.',
    b: 'it operates at a fraction of the power.', rel: 'addition' },
  { a: 'Many of the region\'s traditional dyes were derived from local plants.',
    b: 'the deep blue characteristic of the textiles came from a fermented indigo leaf.', rel: 'example' },
  { a: 'Critics initially dismissed the novel as structurally incoherent.',
    b: 'it is now widely taught as a foundational work of the form.', rel: 'contrast' },
  { a: 'Volcanic ash from the eruption circulated through the upper atmosphere for months.',
    b: 'average global temperatures dropped measurably the following year.', rel: 'cause' },
  { a: 'The library digitised its entire collection of regional newspapers.',
    b: 'it made the resulting archive freely searchable by the public.', rel: 'addition' },
  { a: 'Some fungi form cooperative relationships with the roots of trees.',
    b: 'mycorrhizal networks can transfer nutrients between separate plants.', rel: 'example' },
  { a: 'The prototype performed well in controlled laboratory conditions.',
    b: 'field trials in humid climates revealed a persistent calibration drift.', rel: 'contrast' },
  { a: 'The river deposits sediment continuously along the inner bank of each bend.',
    b: 'the channel migrates slowly across the floodplain over centuries.', rel: 'cause' }
];

function generateTransition(rng, diff) {
  const pair = rng.pick(TRANSITION_PAIRS);
  const families = Object.keys(TRANSITION_FAMILIES);
  const wrongFamilies = rng.shuffle(families.filter((f) => f !== pair.rel)).slice(0, 3);

  const correct = rng.pick(TRANSITION_FAMILIES[pair.rel]);

  /* Every wrong option here comes from a known relationship family, so the
     reason it is wrong can be stated exactly rather than guessed at. Deriving
     it beats hand-writing three lines per item: the explanation cannot drift
     out of step with the option it describes, because it is computed from the
     same fact that chose the option. */
  const FAMILY_CLAIM = {
    contrast: 'signals a contrast, as if the second sentence opposed the first',
    cause:    'signals cause and effect, as if the second sentence followed from the first',
    addition: 'signals another point of the same kind',
    example:  'signals an example, as if the second sentence illustrated the first',
    sequence: 'signals a step in a sequence',
    emphasis: 'signals emphasis or restatement'
  };
  const distractors = wrongFamilies.map((f) => {
    const claim = FAMILY_CLAIM[f] || ('signals a ' + f + ' relationship');
    return { v: rng.pick(TRANSITION_FAMILIES[f]),
             why: 'This ' + claim + ', which is not the relationship between these two sentences.' };
  });

  const relWord = {
    contrast: 'the second sentence qualifies or opposes the first',
    cause: 'the second sentence states a consequence of the first',
    addition: 'the second sentence adds a further point of the same kind',
    example: 'the second sentence gives a specific instance of the first'
  }[pair.rel];

  return makeMC(rng, {
    section: 'rw', domain: D_EXPR, skill: 'transitions', qtype: 'rw-transition', difficulty: diff,
    passage: pair.a + ' ______ ' + pair.b,
    stem: 'Which choice completes the text with the most logical transition?',
    correct, distractors,
    explanation: 'Here ' + relWord + ', so a ' + pair.rel + ' transition is required.'
  });
}

/* =========================================================================
   2. BOUNDARIES  (fully parameterised)

   Two independent clauses, joined correctly one way and incorrectly three
   ways. Each wrong choice commits one specific, nameable error.
   ========================================================================= */

/* `conj` is the ONE coordinating conjunction that fits the logical relation
   between the two clauses, and it is stored rather than chosen at random.

   Picking from ['and','but','so'] at generation time - which is what this did -
   produces a "correct" answer that is grammatically well formed and
   semantically false: "Glassblowing requires constant rotation of the pipe,
   BUT gravity would otherwise pull the molten form out of true." A question
   whose key is nonsense teaches the student the wrong thing twice over, and
   nothing in the punctuation checks could ever catch it, because the fault is
   in the meaning rather than the marks. */
const CLAUSE_PAIRS = [
  { a: 'The observatory sits on a ridge above the treeline',
    b: 'its dome is visible from the valley floor on clear nights', conj: 'and' },
  { a: 'Glassblowing requires constant rotation of the pipe',
    b: 'gravity would otherwise pull the molten form out of true', conj: 'for' },
  { a: 'The manuscript had been stored in a damp cellar for decades',
    b: 'several of its pages were beyond restoration', conj: 'so' },
  { a: 'Arctic terns migrate farther than any other bird',
    b: 'some individuals cover more than seventy thousand kilometres each year', conj: 'and' },
  { a: 'The factory once produced textile machinery for the entire region',
    b: 'it now houses a museum and a series of workshops', conj: 'but' },
  { a: 'Soil samples from the site contained an unusual concentration of iron',
    b: 'the surrounding bedrock offered no obvious source for it', conj: 'but' },
  { a: 'The composer wrote the quartet in less than three weeks',
    b: 'she revised it steadily for the next eleven years', conj: 'but' },
  { a: 'Tidal pools support an unusually dense range of species',
    b: 'the organisms living there must tolerate sharp swings in temperature and salinity', conj: 'but' },
  { a: 'The railway line was abandoned in the early 1960s',
    b: 'much of the original track bed remains intact', conj: 'but' },
  { a: 'Lichens grow extremely slowly on exposed rock',
    b: 'their size can be used to estimate how long a surface has been uncovered', conj: 'so' },
  { a: 'The printing house kept detailed records of every order it filled',
    b: 'those ledgers now provide a rare picture of the period\'s reading habits', conj: 'and' },
  { a: 'Desert nights cool rapidly after sunset',
    b: 'the dry air holds very little of the day\'s accumulated heat', conj: 'for' },
  { a: 'The sculpture was cast in a single pour',
    b: 'no seams are visible anywhere on its surface', conj: 'so' },
  { a: 'Researchers tagged forty individual whales over two seasons',
    b: 'only nine of the tags transmitted for the full duration of the study', conj: 'but' },
  { a: 'The city rebuilt its seawall after the 1938 storm',
    b: 'the new structure was designed to absorb wave energy rather than deflect it', conj: 'and' },
  { a: 'Handmade paper draws its strength from the length of its fibres',
    b: 'industrial pulping shortens those fibres considerably', conj: 'but' }
];

function generateBoundaries(rng, diff) {
  const pair = rng.pick(CLAUSE_PAIRS);
  const a = pair.a, b = pair.b;
  const bCap = b.charAt(0).toUpperCase() + b.slice(1);

  // Which correct join to present. All three are legitimate; the distractors
  // are built around whichever one is chosen.
  const style = rng.pick(['period', 'semicolon', 'commaFanboys']);

  let correct, explanation;
  if (style === 'period') {
    correct = a + '. ' + bCap + '.';
    explanation = 'Two independent clauses may be separated by a period.';
  } else if (style === 'semicolon') {
    correct = a + '; ' + b + '.';
    explanation = 'A semicolon correctly joins two closely related independent clauses.';
  } else {
    correct = a + ', ' + pair.conj + ' ' + b + '.';
    explanation = 'A comma plus the coordinating conjunction "' + pair.conj +
                  '" correctly joins two independent clauses.';
  }

  /* Each distractor commits exactly one named error, and - the part that
     matters - every one of them is wrong for EVERY pair in the bank.

     The colon version that used to sit here was not. A colon may introduce an
     explanation or elaboration, which is precisely the relation half of these
     pairs have: "Desert nights cool rapidly after sunset: the dry air holds
     very little of the day's accumulated heat" is correct English. Roughly a
     third of the questions this generator produced therefore had two right
     answers, and the student who picked the better one was marked wrong. */
  /* Each carries the name of the error it commits. Derived from the same fact
     that built it, so a reason can never describe a different option than the
     one it is attached to. */
  const distractors = [
    { v: a + ', ' + b + '.',
      why: 'A comma splice. Both halves could stand alone as sentences, and a ' +
           'comma is not strong enough to join two of those by itself.' },
    { v: a + ' ' + b + '.',
      why: 'A run-on. With no punctuation at all between them, nothing tells ' +
           'the reader where the first complete idea ends and the second starts.' },
    { v: a + '; ' + pair.conj + ' ' + b + '.',
      why: 'The semicolon already joins the two clauses, so "' + pair.conj +
           '" joins them a second time. Use one or the other, never both.' }
  ];

  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'boundaries', qtype: 'rw-boundaries-sentence', difficulty: diff,
    // The text is shown, as the real test always does, rather than living
    // only inside the answer choices.
    passage: a + ' ______ ' + b + '.',
    stem: STEM_CONVENTIONS,
    correct, distractors,
    explanation: explanation +
      ' A comma alone creates a comma splice, no punctuation at all creates a ' +
      'run-on, and a semicolon does the joining by itself, so adding "' +
      pair.conj + '" after it is redundant.'
  });
}

/* Nonessential-clause offsetting - the paired-punctuation rule. */
const APPOSITIVE_ITEMS = [
  { subj: 'The kestrel', app: 'a small falcon common across open farmland',
    rest: 'hunts by hovering almost motionless above a fixed point' },
  { subj: 'Cordite', app: 'a smokeless propellant patented in 1889',
    rest: 'replaced black powder in most military applications within a decade' },
  { subj: 'The Bodleian', app: 'one of the oldest libraries in Europe',
    rest: 'has held a copy of every British publication since 1610' },
  { subj: 'Basalt', app: 'the most common volcanic rock on Earth',
    rest: 'forms the bulk of the ocean floor' },
  { subj: 'Ada Lovelace', app: 'a mathematician working in the 1840s',
    rest: 'described an algorithm intended for a machine that was never built' },
  { subj: 'The monsoon', app: 'a seasonal reversal of prevailing winds',
    rest: 'delivers most of the region\'s annual rainfall in roughly four months' }
];

function generateAppositive(rng, diff) {
  const it = rng.pick(APPOSITIVE_ITEMS);
  const style = rng.pick(['commas', 'dashes']);

  const correct = style === 'commas'
    ? it.subj + ', ' + it.app + ', ' + it.rest + '.'
    : it.subj + ' - ' + it.app + ' - ' + it.rest + '.';

  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'boundaries', qtype: 'rw-boundaries-supplement', difficulty: diff,
    stem: STEM_CONVENTIONS,
    correct,
    distractors: [
      { v: it.subj + ', ' + it.app + ' - ' + it.rest + '.',
        why: 'Opens with a comma and closes with a dash. The pair has to MATCH - ' +
             'two commas, two dashes, or two parentheses - and mixing them is an error ' +
             'even though each mark is fine on its own.' },
      { v: it.subj + ', ' + it.app + ' ' + it.rest + '.',
        why: 'Opens the interruption and never closes it, so the aside runs ' +
             'straight into the rest of the sentence with no way out.' },
      { v: it.subj + ' ' + it.app + ', ' + it.rest + '.',
        why: 'Closes an interruption that was never opened. Nothing marks where ' +
             '"' + it.app + '" began, so the reader has no signal it was an aside.' },
    ],
    explanation: 'Nonessential information must be enclosed by a matching pair of marks - ' +
                 'two commas, two dashes, or two parentheses. Mixing or omitting one is an error.'
  });
}

/* =========================================================================
   3. FORM, STRUCTURE, AND SENSE  (fully parameterised)
   The single largest R&W skill on the real test.
   ========================================================================= */

/* Subject-verb agreement across an intervening prepositional phrase - the
   classic proximity trap, where the verb is drawn to the nearest noun. */
const SVA_ITEMS = [
  { subj: 'The collection', plural: false, phrase: 'of nineteenth-century maps',
    sing: 'is', plur: 'are', rest: 'housed in a climate-controlled vault' },
  { subj: 'The samples', plural: true, phrase: 'taken from the lower sediment layer',
    sing: 'shows', plur: 'show', rest: 'unusually high mineral content' },
  { subj: 'A series', plural: false, phrase: 'of controlled burns',
    sing: 'has', plur: 'have', rest: 'reduced the density of undergrowth in the reserve' },
  { subj: 'The findings', plural: true, phrase: 'of the recent survey',
    sing: 'suggests', plur: 'suggest', rest: 'a slow but steady recovery' },
  { subj: 'The cost', plural: false, phrase: 'of the necessary repairs',
    sing: 'exceeds', plur: 'exceed', rest: 'the museum\'s annual maintenance budget' },
  { subj: 'The instruments', plural: true, phrase: 'aboard the research vessel',
    sing: 'records', plur: 'record', rest: 'salinity at thirty-second intervals' },
  { subj: 'One', plural: false, phrase: 'of the earliest surviving manuscripts',
    sing: 'remains', plur: 'remain', rest: 'in private hands' },
  { subj: 'The effects', plural: true, phrase: 'of the prolonged drought',
    sing: 'was', plur: 'were', rest: 'visible across the whole catchment' }
];

function generateSubjectVerbAgreement(rng, diff) {
  const it = rng.pick(SVA_ITEMS);
  const correct = it.plural ? it.plur : it.sing;
  const wrong = it.plural ? it.sing : it.plur;

  /* Why any given wrong verb is wrong, worked out from the item rather than
     written next to each option - there are eight items and six branches below,
     and a hand-written reason per pairing is forty-odd chances to attach the
     wrong sentence to the right option. */
  const nearest = it.phrase.split(' ').pop().replace(/[^A-Za-z-]/g, '');
  const number = it.plural ? 'plural' : 'singular';
  const aspectWhy = (v) => {
    if (/^to /.test(v)) {
      return '"' + v + '" is an infinitive. It cannot be the main verb of a ' +
             'sentence, so this leaves the clause with no verb at all.';
    }
    if (/ing$/.test(v)) {
      return '"' + v + '" is a participle, not a finite verb. A main clause needs ' +
             'a verb that carries tense, and a participle on its own does not.';
    }
    return '"' + v + '" does not agree with "' + it.subj.toLowerCase() +
           '", which is ' + number + '.';
  };

  // Three wrong choices: the proximity error plus two tense/aspect errors.
  const raw = [];
  if (correct === 'is')       raw.push('were', 'being');
  else if (correct === 'are') raw.push('was', 'being');
  else if (correct === 'has') raw.push('have been', 'having');
  else if (correct === 'have')raw.push('has been', 'having');
  else if (correct === 'were')raw.push('is', 'being');
  else if (correct === 'was') raw.push('are', 'being');
  else raw.push(correct.replace(/s$/, '') + 'ing', 'to ' + correct.replace(/s$/, ''));

  const distractors = [{
    v: wrong,
    why: '"' + wrong + '" agrees with "' + nearest + '", the noun sitting closest ' +
         'to the blank, instead of with the subject "' + it.subj.toLowerCase() +
         '". That is the entire trap in this question type.'
  }].concat(raw.map((v) => ({ v, why: aspectWhy(v) })));

  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', qtype: 'rw-fss-subject-verb', difficulty: diff,
    passage: it.subj + ' ' + it.phrase + ' ______ ' + it.rest + '.',
    stem: STEM_CONVENTIONS,
    correct, distractors,
    explanation: 'The subject is "' + it.subj.toLowerCase() + '", which is ' +
                 (it.plural ? 'plural' : 'singular') + '. The phrase "' + it.phrase +
                 '" sits between the subject and the verb but does not change what the verb must agree with.'
  });
}

/* Pronoun-antecedent agreement.

   Every distractor here has to be wrong under BOTH the traditional rule and
   ordinary modern usage, or the item has two right answers.

   The entry this bank opened with failed that test outright: "Each of the
   researchers submitted ______ notebook" keyed to "their own" while offering
   "his or her own" as a distractor. Those are both correct - one is the
   traditional agreement, the other the now-standard singular they - and the
   item's own explanation said so, which should have been the giveaway. The
   real test does not put a live usage dispute in the answer choices, so it is
   gone, replaced by antecedents whose number is not in question.

   Each item now carries its own frame; the shared "submitted ___ X" sentence
   forced awkward phrasings on antecedents it did not suit. */
const PRONOUN_ITEMS = [
  { correct: 'its', wrong: ['their', 'it\'s', 'they\'re'],
    frame: 'The committee delivered ______ recommendation to the council in October.',
    note: 'A collective noun treated as a single body takes a singular pronoun, and ' +
          '"it\'s" is a contraction of "it is" rather than a possessive.' },
  { correct: 'its', wrong: ['their', 'it\'s', 'those'],
    frame: 'Neither of the two prototypes reached ______ target weight.',
    note: '"Neither" is singular, so the pronoun referring back to it must be singular.' },
  { correct: 'their', wrong: ['its', 'his', 'there'],
    frame: 'The volunteers checked ______ equipment before the survey began.',
    note: '"Volunteers" is plural and takes a plural pronoun.' },
  { correct: 'it', wrong: ['them', 'they', 'this'],
    frame: 'Because the alloy expands unevenly, engineers test ______ across the full temperature range.',
    note: 'The antecedent is "the alloy", a singular noun, so the object pronoun must be singular.' },
  { correct: 'they', wrong: ['it', 'them', 'those'],
    frame: 'The bridge\'s cables are inspected every spring, since ______ carry the entire deck load.',
    note: 'The antecedent is "cables", which is plural, and the pronoun is the subject of ' +
          'its clause, so the plural subject pronoun is required.' },
  /* Deliberately an inanimate antecedent. An item keyed to "his" or "her" for
     an unnamed person - "the curator ... ______ retirement" - would have the
     same two-right-answers defect that emptied this bank in the first place,
     since nothing in the sentence rules out "their". */
  { correct: 'its', wrong: ['their', 'his', 'it'],
    frame: 'Each of the three telescopes was calibrated against ______ own reference star.',
    note: '"Each" is singular, and the thing referred back to is a telescope, so the ' +
          'singular possessive is the only form that agrees.' }
];

/* What each pronoun actually IS. Six items times three wrong options is
   eighteen reasons; stating the facts once and deriving from them is both
   shorter and impossible to get out of step with the options themselves. */
const PRONOUN_FACTS = {
  /* `refers` separates two pronouns that agree on everything else. "Its" and
     "his" are both singular possessives, so number and role both match and
     neither rule below fires - the only thing wrong with "his" next to a
     telescope is what it can point at. */
  'its':     { num: 'singular', kind: 'possessive', refers: 'a thing' },
  'their':   { num: 'plural',   kind: 'possessive' },
  'his':     { num: 'singular', kind: 'possessive', refers: 'a male person' },
  'it':      { num: 'singular', kind: 'pronoun' },
  'they':    { num: 'plural',   kind: 'subject pronoun' },
  'them':    { num: 'plural',   kind: 'object pronoun' },
  'this':    { num: 'singular', kind: 'demonstrative' },
  'those':   { num: 'plural',   kind: 'demonstrative' },
  "it's":    { contraction: 'it is' },
  "they're": { contraction: 'they are' },
  "who's":   { contraction: 'who is' },
  'there':   { place: true }
};

function pronounWhy(correct, wrong) {
  const w = PRONOUN_FACTS[wrong], c = PRONOUN_FACTS[correct];
  if (!w) return null;
  if (w.contraction) {
    return '"' + wrong + '" is a contraction of "' + w.contraction + '". Read the ' +
           'sentence back with the full words in place and it falls apart - this ' +
           'slot needs a possessive, not a verb.';
  }
  if (w.place) {
    return '"There" points at a place. It is not a possessive and it cannot refer ' +
           'back to anything, which is what this blank has to do.';
  }
  if (c && c.num && w.num && c.num !== w.num) {
    return '"' + wrong + '" is ' + w.num + ', and the thing it refers back to is ' +
           c.num + '. A pronoun has to match its antecedent in number.';
  }
  if (c && c.refers && w.refers && c.refers !== w.refers) {
    return '"' + wrong + '" refers to ' + w.refers + '. What this sentence points ' +
           'back to is ' + c.refers + ', so the number is right but the pronoun ' +
           'still cannot stand for it.';
  }
  if (c && c.kind && w.kind && c.kind !== w.kind) {
    return '"' + wrong + '" is a ' + w.kind + ' where the sentence needs a ' +
           c.kind + '. The number is right; the job it does in the sentence is not.';
  }
  return null;
}

function generatePronounAgreement(rng, diff) {
  const it = rng.pick(PRONOUN_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', qtype: 'rw-fss-pronoun', difficulty: diff,
    passage: it.frame,
    stem: STEM_CONVENTIONS,
    correct: it.correct,
    distractors: it.wrong.map((w) => ({ v: w, why: pronounWhy(it.correct, w) })),
    explanation: it.note
  });
}

/* Possessive vs. plural vs. contraction. */
const POSSESSIVE_ITEMS = [
  { correct: 'its', wrong: ["it's", 'its\'', 'it is'],
    frame: 'The engine lost much of ______ efficiency once the seal degraded.',
    note: '"Its" is the possessive form; "it\'s" is a contraction of "it is".' },
  { correct: "researchers'", wrong: ['researchers', "researcher's", 'researchers\'s'],
    frame: 'The three ______ conclusions were published together in a single volume.',
    note: 'Plural possessive: more than one researcher, so the apostrophe follows the s.' },
  { correct: "engineer's", wrong: ['engineers', "engineers'", 'engineers\'s'],
    frame: 'The lead ______ signature appears on every revision of the drawing.',
    note: 'Singular possessive: one engineer, so the apostrophe precedes the s.' },
  { correct: 'their', wrong: ["they're", 'there', "their's"],
    frame: 'The archivists catalogued ______ findings over the following winter.',
    note: '"Their" is possessive; "they\'re" is a contraction and "there" indicates place.' },
  { correct: "whose", wrong: ["who's", 'whos', 'which\'s'],
    frame: 'The geologist ______ field notes survived the fire later published them in full.',
    note: '"Whose" is the possessive; "who\'s" is a contraction of "who is".' }
];

/* Apostrophe errors fall into a handful of named shapes, and the shape can be
   read off the two strings. Classifying beats annotating: the bank grows, and
   an item added later gets its reasons for free rather than silently arriving
   with none. */
const CONTRACTIONS = { "it's": 'it is', "they're": 'they are', "who's": 'who is',
                       'it is': 'it is', "there's": 'there is' };
const PRONOUN_POSSESSIVES = ['its', 'their', 'theirs', 'whose', 'his', 'hers',
                             'ours', 'yours'];

function genitiveWhy(correct, wrong) {
  if (CONTRACTIONS[wrong]) {
    return '"' + wrong + '" means "' + CONTRACTIONS[wrong] + '". Say it back in full ' +
           'and the sentence stops making sense - nothing is being contracted here, ' +
           'something is being owned.';
  }
  if (wrong === 'there') {
    return '"There" points at a place. It sounds identical and does a completely ' +
           'different job.';
  }
  if (PRONOUN_POSSESSIVES.indexOf(correct) !== -1) {
    if (/'/.test(wrong)) {
      return '"' + wrong + '" puts an apostrophe on a possessive pronoun. Its, their, ' +
             'whose, hers and ours are already possessive and never take one.';
    }
    return '"' + wrong + '" is not a form English has. The possessive here is "' +
           correct + '".';
  }
  if (/s's$/.test(wrong)) {
    return '"' + wrong + '" marks the possessive twice on a plural that already ends ' +
           'in s. A plural ending in s takes the apostrophe on its own.';
  }
  if (/'s$/.test(wrong) && /s'$/.test(correct)) {
    return '"' + wrong + '" is the SINGULAR possessive - one owner. The sentence is ' +
           'about more than one, so the apostrophe goes after the s.';
  }
  if (/s'$/.test(wrong) && /'s$/.test(correct)) {
    return '"' + wrong + '" is the PLURAL possessive - several owners. The sentence is ' +
           'about one, so the apostrophe goes before the s.';
  }
  if (!/'/.test(wrong)) {
    return '"' + wrong + '" has no apostrophe at all, so it is a plain plural. It says ' +
           'there is more than one; it does not say anything belongs to them.';
  }
  return null;
}

function generatePossessive(rng, diff) {
  const it = rng.pick(POSSESSIVE_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', qtype: 'rw-fss-genitive', difficulty: diff,
    passage: it.frame,
    stem: STEM_CONVENTIONS,
    correct: it.correct,
    distractors: it.wrong.map((w) => ({ v: w, why: genitiveWhy(it.correct, w) })),
    explanation: it.note
  });
}

/* Dangling and misplaced modifiers. */
const MODIFIER_ITEMS = [
  { opener: 'Having been sealed for three centuries', subj: 'the chamber',
    correct: 'the chamber contained air of a markedly different composition',
    wrong: ['researchers found the chamber\'s air markedly different',
            'the composition of the air was markedly different to researchers',
            'it was found that the air had a markedly different composition'],
    note: 'The opening phrase describes the chamber, so "the chamber" must be the subject of the main clause.' },
  { opener: 'Trained to detect a single scent among hundreds', subj: 'the dogs',
    correct: 'the dogs located the sample within minutes',
    wrong: ['the sample was located by the dogs within minutes',
            'it took the dogs only minutes to locate the sample',
            'locating the sample took the dogs only minutes'],
    note: 'The modifier describes the dogs, so "the dogs" must follow it directly as the subject.' },
  { opener: 'Written entirely in the margins of a printed almanac', subj: 'the diary',
    correct: 'the diary escaped the attention of censors for years',
    wrong: ['censors overlooked the diary for years',
            'no censor noticed the diary for years',
            'it was years before censors noticed the diary'],
    note: 'The opening phrase describes the diary, which must therefore be the subject of the main clause.' }
];

function generateModifier(rng, diff) {
  const it = rng.pick(MODIFIER_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', qtype: 'rw-fss-modifier', difficulty: diff,
    passage: it.opener + ', ______.',
    stem: STEM_CONVENTIONS,
    correct: it.correct,
    /* One shape of error, three instances of it, so the reason is written once
       against the fact that makes each of them wrong: whatever the choice puts
       first is what the opening phrase ends up describing. */
    distractors: it.wrong.map((w) => ({
      v: w,
      why: 'Read it straight through: "' + it.opener + ', ' + w + '". The opening ' +
           'phrase describes ' + it.subj + ', but this choice does not put ' +
           it.subj + ' first, so the phrase is left dangling.'
    })),
    explanation: it.note + ' The other choices leave the opening phrase dangling, ' +
                 'attached to a subject it cannot logically describe.'
  });
}

/* Verb tense driven by an explicit time signal. */
const TENSE_ITEMS = [
  { frame: 'By the time the survey team arrived in 1974, the glacier ______ nearly a kilometre.',
    correct: 'had retreated', wrong: ['has retreated', 'retreats', 'will have retreated'],
    signal: 'by the time the team arrived in 1974',
    want: 'the past perfect, for an action finished before another past event',
    note: 'An action completed before another past event takes the past perfect.' },
  { frame: 'Since the restoration began in 2019, conservators ______ more than sixty panels.',
    correct: 'have treated', wrong: ['treated', 'had treated', 'will treat'],
    signal: 'since 2019',
    want: 'the present perfect, for something begun in the past and still going on',
    note: '"Since" with a period continuing into the present calls for the present perfect.' },
  { frame: 'Next spring the institute ______ a second expedition to the same valley.',
    correct: 'will send', wrong: ['sent', 'has sent', 'had sent'],
    signal: 'next spring',
    want: 'the simple future',
    note: 'A stated future time requires a future-tense verb.' },
  { frame: 'The kiln reached its peak temperature at dawn and ______ steadily for two days afterward.',
    correct: 'cooled', wrong: ['cools', 'has cooled', 'will cool'],
    signal: 'reached ... at dawn',
    want: 'the simple past, matching the verb it is paired with',
    note: 'The two verbs describe the same completed past sequence, so both must be simple past.' }
];

/* Naming the tense a wrong choice actually is turns "that is not it" into
   something a student can use twice. Keyed on the exact strings above, so a
   new item that forgets to list its forms gets no reason rather than a wrong
   one - which the coverage sweep then reports. */
const TENSE_NAMES = {
  'retreats': 'the simple present', 'has retreated': 'the present perfect',
  'will have retreated': 'the future perfect',
  'treated': 'the simple past', 'had treated': 'the past perfect',
  'will treat': 'the simple future',
  'sent': 'the simple past', 'has sent': 'the present perfect',
  'had sent': 'the past perfect',
  'cools': 'the simple present', 'has cooled': 'the present perfect',
  'will cool': 'the simple future'
};

function generateTense(rng, diff) {
  const it = rng.pick(TENSE_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', qtype: 'rw-fss-verb-tense', difficulty: diff,
    passage: it.frame,
    stem: STEM_CONVENTIONS,
    correct: it.correct,
    distractors: it.wrong.map((w) => ({
      v: w,
      why: TENSE_NAMES[w]
        ? '"' + w + '" is ' + TENSE_NAMES[w] + '. The time signal in the sentence - ' +
          '"' + it.signal + '" - calls for ' + it.want + '.'
        : null
    })),
    explanation: it.note
  });
}

/* =========================================================================
   4. WORDS IN CONTEXT  (template + authored bank)
   Each entry supplies its own vetted distractor set: a register mismatch,
   a related-but-wrong sense, and a common confusable.
   ========================================================================= */

/* Every wrong option carries the reason it fails.

   These cannot be derived the way the Conventions reasons are. A grammar error
   has a name; a wrong word is wrong because of what the surrounding sentence
   means, and the only honest way to say so is to say so. Each one names the
   signal in the frame that rules the option out, because "it does not fit" is
   something a student already knew before they got it wrong. */
const VOCAB_ITEMS = [
  { frame: 'Although the theory was initially dismissed, decades of subsequent evidence have ______ its central claim.',
    correct: 'corroborated',
    wrong: [
      { v: 'fabricated', why: 'Fabricated means invented or made up. That would make the evidence dishonest, where the contrast with "initially dismissed" needs it to have supported the claim.' },
      { v: 'complicated', why: 'Complicated means made more difficult. The sentence turns on the theory being vindicated over decades, not muddied.' },
      { v: 'tolerated', why: 'Tolerated means put up with. Evidence does not put up with a claim - the contrast with "dismissed" calls for active support.' }
    ] },
  { frame: 'The report is deliberately ______: it states the findings plainly and offers no interpretation whatsoever.',
    correct: 'austere',
    wrong: [
      { v: 'ornate', why: 'Ornate means heavily decorated, which is the opposite of the plainness the colon goes on to describe.' },
      { v: 'evasive', why: 'Evasive means dodging the point. Withholding interpretation is not the same as avoiding the subject - the findings are stated plainly.' },
      { v: 'exhaustive', why: 'Exhaustive means covering everything. The sentence is about how little the report adds, not how much ground it covers.' }
    ] },
  { frame: 'Far from being uniform, the sediment layers proved remarkably ______, varying in composition every few centimetres.',
    correct: 'heterogeneous',
    wrong: [
      { v: 'homogeneous', why: 'Homogeneous means uniform throughout, which "Far from being uniform" rules out. This is the trap: the two words differ by one prefix and mean opposite things.' },
      { v: 'permeable', why: 'Permeable means letting liquid through. True of many sediments, and unrelated to whether their composition varies.' },
      { v: 'sedimentary', why: 'Sedimentary only repeats that these are sediment layers. It says nothing about variation, which is what the rest of the sentence is about.' }
    ] },
  { frame: 'The committee\'s support was ______ rather than wholehearted; several members signed only after long hesitation.',
    correct: 'tepid',
    wrong: [
      { v: 'fervent', why: 'Fervent means intense and passionate, which is what "rather than wholehearted" explicitly rules out.' },
      { v: 'unanimous', why: 'Unanimous describes how many agreed, not how strongly. They all did sign, so the count is not what the sentence is measuring.' },
      { v: 'hostile', why: 'Hostile overshoots. They signed, however reluctantly, and hostile support is a contradiction.' }
    ] },
  { frame: 'Her prose is ______, conveying in a single clause what other writers labour over for a paragraph.',
    correct: 'economical',
    wrong: [
      { v: 'verbose', why: 'Verbose means using too many words, the opposite of saying in one clause what others take a paragraph over.' },
      { v: 'affordable', why: 'This is the money sense of "economical". The sentence is about her prose, not its price - the right word has two senses and only one of them fits.' },
      { v: 'ambiguous', why: 'Ambiguous means open to more than one reading. Brevity and vagueness are different things, and nothing here says she is unclear.' }
    ] },
  { frame: 'The artist rejected the label entirely, insisting that her work ______ any single tradition.',
    correct: 'transcends',
    wrong: [
      { v: 'imitates', why: 'Imitates means copies. She rejected the label, so her work goes beyond a tradition rather than following one.' },
      { v: 'establishes', why: 'Establishes means founds or sets up. That would tie her work to a single tradition, which is exactly what she is denying.' },
      { v: 'descends', why: 'Descends looks close to "transcends" and points the other way: it means comes down from, which is again a claim of belonging.' }
    ] },
  { frame: 'Because the samples had been stored improperly, the results of the earlier analysis are now considered ______.',
    correct: 'unreliable',
    wrong: [
      { v: 'definitive', why: 'Definitive means settled beyond doubt. Improper storage undermines results; it cannot confirm them.' },
      { v: 'unavailable', why: 'Unavailable means not obtainable. The results exist and can be read - the question is whether they can be trusted.' },
      { v: 'unpopular', why: 'Unpopular is about how people feel. A storage failure affects accuracy, not reception.' }
    ] },
  { frame: 'The compound remains ______ at room temperature, decomposing only when heated past 400 degrees.',
    correct: 'stable',
    wrong: [
      { v: 'volatile', why: 'Volatile means readily evaporating or unstable, the opposite of a compound that holds together until 400 degrees.' },
      { v: 'soluble', why: 'Soluble means dissolving in a liquid. The sentence is about heat, not solution.' },
      { v: 'abundant', why: 'Abundant means plentiful. How much of it exists has nothing to do with whether it decomposes.' }
    ] },
  { frame: 'Rather than settling the debate, the new data ______ it, raising questions no one had thought to ask.',
    correct: 'reinvigorated',
    wrong: [
      { v: 'resolved', why: 'Resolved means settled, which "Rather than settling the debate" rules out in the same sentence.' },
      { v: 'summarised', why: 'Summarised means restated briefly. Raising questions nobody had asked is the opposite of condensing what was already there.' },
      { v: 'abandoned', why: 'Abandoned means gave up on. The debate is still running - new questions are what keep it alive.' }
    ] },
  { frame: 'The building\'s design is unapologetically ______, borrowing freely from four centuries of architecture.',
    correct: 'eclectic',
    wrong: [
      { v: 'austere', why: 'Austere means plain and unadorned. Borrowing freely from four centuries is the opposite of restraint.' },
      { v: 'derivative', why: 'Derivative means unoriginal, leaning on one source. Drawing deliberately on many is not the same failing, and "unapologetically" marks this as a choice.' },
      { v: 'symmetrical', why: 'Symmetrical describes balance in shape. It says nothing about where the design takes its ideas from.' }
    ] },
  { frame: 'His account of the expedition is valuable precisely because it is so ______, recording failures alongside successes.',
    correct: 'candid',
    wrong: [
      { v: 'flattering', why: 'Flattering means making something look better than it was, which "recording failures alongside successes" rules out.' },
      { v: 'concise', why: 'Concise means short. The sentence praises what he puts in, not how briefly he says it.' },
      { v: 'technical', why: 'Technical means specialised in detail. Recording failures is a matter of honesty, not vocabulary.' }
    ] },
  { frame: 'The population decline was not sudden but ______, unfolding over nearly two hundred years.',
    correct: 'gradual',
    wrong: [
      { v: 'abrupt', why: 'Abrupt means sudden, and "not sudden but" rules it out four words earlier.' },
      { v: 'severe', why: 'Severe describes how bad the decline was, not how fast. "Over nearly two hundred years" is about pace.' },
      { v: 'reversible', why: 'Reversible means able to be undone. Nothing in the sentence is about whether the population recovered.' }
    ] },
  { frame: 'Critics found the argument ______: it assumed at the outset the very conclusion it claimed to prove.',
    correct: 'circular',
    wrong: [
      { v: 'persuasive', why: 'Persuasive means convincing. Critics are objecting, and the colon explains why the argument fails.' },
      { v: 'lengthy', why: 'Lengthy means long. The complaint is about the shape of the argument, not its size.' },
      { v: 'original', why: 'Original means new. Assuming your own conclusion is a very old mistake, and the colon describes a flaw rather than a virtue.' }
    ] },
  { frame: 'The treaty\'s language is intentionally ______, allowing each signatory to interpret its terms favourably.',
    correct: 'ambiguous',
    wrong: [
      { v: 'precise', why: 'Precise means exact, the opposite of language each signatory can read in its own favour.' },
      { v: 'archaic', why: 'Archaic means old-fashioned. Old wording is not the same as wording open to several readings.' },
      { v: 'binding', why: 'Binding means legally enforceable. Whether it binds is a separate question from whether its terms are clear.' }
    ] },
  { frame: 'Once ______ across the entire continent, the species now survives in three isolated valleys.',
    correct: 'ubiquitous',
    wrong: [
      { v: 'endangered', why: 'Endangered describes the species now, not then. "Once" sets up a contrast with the three isolated valleys that follow.' },
      { v: 'nocturnal', why: 'Nocturnal means active at night. It says nothing about how widespread the species was.' },
      { v: 'introduced', why: 'Introduced means brought in from elsewhere. The sentence is about range, not origin.' }
    ] },
  { frame: 'The editor\'s changes were largely ______, correcting spelling without altering the argument.',
    correct: 'superficial',
    wrong: [
      { v: 'substantive', why: 'Substantive means affecting the substance, which "without altering the argument" rules out directly.' },
      { v: 'careless', why: 'Careless means done badly. Correcting spelling is careful work; it is simply not deep work.' },
      { v: 'controversial', why: 'Controversial means disputed. Nobody in the sentence is objecting to anything.' }
    ] },
  { frame: 'Given how little of the structure survives, any reconstruction must remain ______.',
    correct: 'conjectural',
    wrong: [
      { v: 'authoritative', why: 'Authoritative means commanding confidence, which is more than "how little of the structure survives" will support.' },
      { v: 'expensive', why: 'Expensive is about cost. The sentence is about how much can be known, not what finding out would cost.' },
      { v: 'permanent', why: 'Permanent means lasting. How durable a reconstruction is has nothing to do with how much evidence stands behind it.' }
    ] },
  { frame: 'The two accounts are not merely different but ______: if one is accurate, the other cannot be.',
    correct: 'incompatible',
    wrong: [
      { v: 'complementary', why: 'Complementary means fitting together to complete each other, the opposite of two accounts that cannot both be true.' },
      { v: 'comparable', why: 'Comparable means similar enough to set side by side. The sentence starts from their being different and then goes further.' },
      { v: 'inconsistent', why: 'This is the near miss. Inconsistent accounts disagree in places; the colon says that if one is right the other cannot be at all, which is stronger.' }
    ] },
  { frame: 'The instrument is sensitive enough to detect ______ shifts that earlier equipment would have missed entirely.',
    correct: 'minute',
    wrong: [
      { v: 'immense', why: 'Immense means huge. Equipment sensitive enough to catch what others missed is picking up something small.' },
      { v: 'gradual', why: 'Gradual describes how slowly a shift happens, not how small it is. A slow change can be enormous.' },
      { v: 'temporary', why: 'Temporary describes how long a shift lasts. Duration is not size.' }
    ] },
  { frame: 'Her influence on the field is difficult to ______, since so much later work simply assumes her framework.',
    correct: 'overstate',
    wrong: [
      { v: 'establish', why: 'Establish means to prove. Her influence is not in doubt here - the sentence is about its scale.' },
      { v: 'understand', why: 'That would say her influence is hard to grasp, but the clause after "since" is a reason it is very large.' },
      { v: 'appreciate', why: 'Appreciate means to recognise the value of. Later work assuming her framework makes her influence easier to see, not harder.' }
    ] },
  { frame: 'The colony persists in conditions that would prove ______ to almost any other organism.',
    correct: 'lethal',
    wrong: [
      { v: 'agreeable', why: 'Agreeable means pleasant. The sentence contrasts this colony with organisms that could not manage there at all.' },
      { v: 'temporary', why: 'Temporary describes how long conditions last, not what they do to an organism.' },
      { v: 'unfamiliar', why: 'Unfamiliar only means unknown. Persisting where others could not needs a stronger word than "strange".' }
    ] },
  { frame: 'What appears at first to be decorative is in fact ______: every mark records a measurement.',
    correct: 'functional',
    wrong: [
      { v: 'ornamental', why: 'Ornamental means decorative, which is precisely the thing the sentence says it only appears to be.' },
      { v: 'illegible', why: 'Illegible means unreadable. The marks record measurements, so they can be read.' },
      { v: 'accidental', why: 'Accidental means unintended, but the colon says every mark records something, which is deliberate.' }
    ] },
  { frame: 'The author is careful to ______ her claim, noting that it applies only to the earliest period.',
    correct: 'qualify',
    wrong: [
      { v: 'abandon', why: 'Abandon means to drop entirely. She keeps the claim and narrows where it applies.' },
      { v: 'exaggerate', why: 'Exaggerate means to overstate. Limiting a claim to one period does the opposite.' },
      { v: 'restate', why: 'Restate means to say again. Adding a limit changes the claim rather than repeating it.' }
    ] },
  { frame: 'Rather than a single catastrophe, the collapse was the ______ result of many small failures.',
    correct: 'cumulative',
    wrong: [
      { v: 'immediate', why: 'Immediate means happening at once, which "Rather than a single catastrophe" rules out.' },
      { v: 'accidental', why: 'Accidental means unintended. Each failure may well have been, but the sentence is about how they added up.' },
      { v: 'predictable', why: 'Predictable means foreseeable. Whether anyone saw it coming is a different matter from many small failures accumulating.' }
    ] }
];

function generateWordsInContext(rng, diff) {
  const it = rng.pick(VOCAB_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CRAFT, skill: 'words-in-context', qtype: 'rw-words-in-context', difficulty: diff,
    passage: it.frame,
    stem: 'Which choice completes the text with the most logical and precise word or phrase?',
    correct: it.correct, distractors: it.wrong.slice(),
    explanation: 'The surrounding sentence signals the required meaning; only "' + it.correct +
                 '" matches it in both sense and degree.'
  });
}

/* =========================================================================
   5. RHETORICAL SYNTHESIS  (template + authored bank)
   Bulleted notes plus an explicit goal. The correct choice uses exactly the
   bullets that serve the stated goal and nothing else.
   ========================================================================= */

const SYNTHESIS_TOPICS = [
  {
    title: 'the Antikythera mechanism',
    notes: ['Recovered from a shipwreck off the Greek island of Antikythera in 1901.',
            'Dates to roughly the second century BCE.',
            'Contains at least thirty interlocking bronze gears.',
            'Used to predict the positions of the sun and moon and the timing of eclipses.',
            'No comparable geared device is known for the next thousand years.'],
    goals: [
      { goal: 'explain what the mechanism was used for',
        correct: 'The Antikythera mechanism was used to predict the positions of the sun and moon and the timing of eclipses.',
        wrong: ['The Antikythera mechanism, recovered in 1901, dates to roughly the second century BCE.',
                'The Antikythera mechanism contains at least thirty interlocking bronze gears.',
                'No device comparable to the Antikythera mechanism is known for the next thousand years.'] },
      { goal: 'emphasise how unusual the device was for its era',
        correct: 'Although it dates to the second century BCE, no device comparable to the Antikythera mechanism is known for the next thousand years.',
        wrong: ['The Antikythera mechanism was recovered from a shipwreck in 1901.',
                'The Antikythera mechanism predicted the positions of the sun and moon.',
                'The Antikythera mechanism contains at least thirty bronze gears.'] }
    ]
  },
  {
    title: 'the Svalbard Global Seed Vault',
    notes: ['Opened in 2008 on a Norwegian island inside the Arctic Circle.',
            'Built into the side of a sandstone mountain.',
            'Stores duplicate samples of seeds held in gene banks worldwide.',
            'Surrounding permafrost keeps the chambers cold even without power.',
            'Made its first withdrawal in 2015, to replace seeds lost in Syria.'],
    goals: [
      { goal: 'explain the purpose of the vault',
        correct: 'The Svalbard Global Seed Vault stores duplicate samples of seeds held in gene banks worldwide.',
        wrong: ['The Svalbard Global Seed Vault opened in 2008 on a Norwegian island inside the Arctic Circle.',
                'The Svalbard Global Seed Vault is built into the side of a sandstone mountain.',
                'The Svalbard Global Seed Vault made its first withdrawal in 2015.'] },
      { goal: 'explain why the location was chosen',
        correct: 'Built into an Arctic mountainside, the vault is surrounded by permafrost that keeps its chambers cold even without power.',
        wrong: ['The vault opened in 2008 and made its first withdrawal in 2015.',
                'The vault stores duplicate samples of seeds from gene banks worldwide.',
                'The vault replaced seeds that had been lost in Syria.'] }
    ]
  },
  {
    title: 'the Voynich manuscript',
    notes: ['A codex of roughly 240 vellum pages.',
            'Radiocarbon dating places the vellum in the early fifteenth century.',
            'Written in an unknown script that matches no documented language.',
            'Illustrated with plants that do not correspond to any known species.',
            'Has resisted decipherment by professional and amateur cryptographers alike.'],
    goals: [
      { goal: 'identify what makes the manuscript difficult to interpret',
        correct: 'The Voynich manuscript is written in an unknown script that matches no documented language.',
        wrong: ['The Voynich manuscript consists of roughly 240 vellum pages.',
                'Radiocarbon dating places the manuscript\'s vellum in the early fifteenth century.',
                'The Voynich manuscript is illustrated throughout with images of plants.'] },
      { goal: 'establish when the manuscript was made',
        correct: 'Radiocarbon dating places the vellum of the Voynich manuscript in the early fifteenth century.',
        wrong: ['The Voynich manuscript has resisted decipherment by cryptographers.',
                'The Voynich manuscript is written in an unknown script.',
                'The Voynich manuscript depicts plants matching no known species.'] }
    ]
  },
  {
    title: 'the Tabby cat genome study',
    notes: ['Researchers sequenced DNA from more than a thousand domestic cats.',
            'The study identified the gene responsible for the tabby coat pattern.',
            'The same gene is active only during a narrow window of embryonic development.',
            'Similar patterning genes were later found in cheetahs.',
            'The work was published in 2021.'],
    goals: [
      { goal: 'explain how the finding extended beyond domestic cats',
        correct: 'Genes similar to the one producing the tabby pattern were later identified in cheetahs.',
        wrong: ['Researchers sequenced DNA from more than a thousand domestic cats.',
                'The study identified the gene responsible for the tabby coat pattern.',
                'The work was published in 2021.'] }
    ]
  },
  {
    title: 'the Iron Pillar of Delhi',
    notes: ['Stands roughly seven metres tall and weighs over six tonnes.',
            'Erected in the fourth or fifth century CE.',
            'Has shown almost no rust despite centuries of outdoor exposure.',
            'Its corrosion resistance comes from a thin protective layer of iron hydrogen phosphate.',
            'That layer formed because of the unusually high phosphorus content of the iron.'],
    goals: [
      { goal: 'explain why the pillar has not rusted',
        correct: 'The pillar\'s high phosphorus content produced a thin protective layer of iron hydrogen phosphate that resists corrosion.',
        wrong: ['The pillar stands roughly seven metres tall and weighs over six tonnes.',
                'The pillar was erected in the fourth or fifth century CE.',
                'The pillar has shown almost no rust despite centuries of exposure.'] }
    ]
  },
  {
    title: 'the Aral Sea',
    notes: ['Once the fourth-largest lake in the world by surface area.',
            'Soviet irrigation projects beginning in the 1960s diverted its two feeder rivers.',
            'By 2007 it had shrunk to about ten percent of its original size.',
            'The exposed lakebed released salt and pesticide dust across the region.',
            'A dam completed in 2005 has partially restored the northern portion.'],
    goals: [
      { goal: 'explain what caused the lake to shrink',
        correct: 'Soviet irrigation projects beginning in the 1960s diverted the two rivers that fed the Aral Sea.',
        wrong: ['The Aral Sea was once the fourth-largest lake in the world by surface area.',
                'By 2007 the Aral Sea had shrunk to about ten percent of its original size.',
                'A dam completed in 2005 has partially restored the northern portion.'] },
      { goal: 'present a development that partly reversed the decline',
        correct: 'A dam completed in 2005 has partially restored the northern portion of the Aral Sea.',
        wrong: ['Soviet irrigation projects diverted the sea\'s two feeder rivers beginning in the 1960s.',
                'The exposed lakebed released salt and pesticide dust across the region.',
                'The Aral Sea was once the fourth-largest lake in the world.'] }
    ]
  }
];

function generateSynthesis(rng, diff) {
  const topic = rng.pick(SYNTHESIS_TOPICS);
  const g = rng.pick(topic.goals);

  const notes = topic.notes.map((n) => '• ' + n).join('\n');

  return makeMC(rng, {
    section: 'rw', domain: D_EXPR, skill: 'rhetorical-synthesis', qtype: 'rw-rhetorical-synthesis', difficulty: 'hard',
    passage: 'While researching a topic, a student has taken the following notes:\n\n' + notes,
    stem: 'The student wants to ' + g.goal + '. Which choice most effectively uses ' +
          'relevant information from the notes to accomplish this goal?',
    correct: g.correct,
    distractors: g.wrong.map((w) => ({ v: w, why: comprehensionWhy('rhetorical-synthesis') })),
    explanation: 'Only this choice uses the notes that bear on the stated goal. ' +
                 'The others cite accurate facts that do not serve it.'
  });
}

/* =========================================================================
   6. COMPREHENSION  (authored outright)
   Central Ideas, Inferences, Text Structure and Purpose, Command of
   Evidence, Cross-Text Connections. Passages are written, not generated.
   ========================================================================= */

const PASSAGES = [
  {
    skill: 'central-ideas', difficulty: 'medium',
    text: 'For most of the twentieth century, the accepted account of how the Hawaiian islands formed ' +
          'held that a stationary plume of hot rock beneath the Pacific plate melted through the crust ' +
          'as the plate drifted northwest, leaving a trail of volcanoes. Recent seismic imaging complicates ' +
          'this picture. The data suggest the plume itself has shifted position over geological time, and ' +
          'that the bend in the island chain reflects movement of the plume as much as movement of the plate.',
    stem: 'Which choice best states the main idea of the text?',
    correct: 'New seismic evidence suggests the Hawaiian island chain was shaped by movement of the underlying plume, not only by movement of the plate.',
    wrong: ['Seismic imaging has become the primary tool for studying volcanic activity beneath the Pacific.',
            'The Hawaiian islands formed as the Pacific plate drifted northwest over a stationary plume.',
            'Geologists have abandoned the idea that plumes of hot rock play any role in island formation.']
  },
  {
    skill: 'central-ideas', difficulty: 'medium',
    text: 'The novelist Dorothy Richardson is often credited with the first sustained use of stream of ' +
          'consciousness in English fiction, yet she disliked the term and resisted its application to her ' +
          'work. She argued that the phrase implied a passive flow, when what she had attempted was ' +
          'something more deliberate: a narration shaped entirely by what one particular mind chose to ' +
          'attend to. The distinction mattered to her because it located the technique in the character\'s ' +
          'judgement rather than in the author\'s arrangement.',
    stem: 'Which choice best states the main idea of the text?',
    correct: 'Richardson objected to the label applied to her technique because it misdescribed the deliberate, selective attention she was trying to represent.',
    wrong: ['Richardson was the first English novelist to write in the stream-of-consciousness style.',
            'Critics have generally misunderstood the structure of Richardson\'s novels.',
            'Richardson believed that authors should not arrange their narratives at all.']
  },
  {
    skill: 'inferences', difficulty: 'medium',
    text: 'Bowhead whales can live more than two hundred years, far longer than any other mammal. Their ' +
          'cells repair damaged DNA unusually efficiently, and they carry duplicate copies of several genes ' +
          'involved in suppressing tumour growth. Despite having thousands of times more cells than a mouse ' +
          '— and therefore thousands of times more opportunities for a cell to turn cancerous — bowheads ' +
          'develop cancer far less often. Researchers studying the species therefore suspect that ______',
    stem: 'Which choice most logically completes the text?',
    correct: 'the whales\' longevity depends on biological defences against cancer that are absent or weaker in shorter-lived mammals.',
    wrong: ['bowhead whales are descended from a smaller ancestor that also resisted cancer.',
            'cancer rates in mammals are determined primarily by the total number of cells in the body.',
            'mice would live substantially longer if they were larger.']
  },
  {
    skill: 'inferences', difficulty: 'hard',
    text: 'Archaeologists excavating a Bronze Age settlement found grain stored in sealed pits well away ' +
          'from any dwelling. Chemical residue on the pit walls indicates the grain had been deliberately ' +
          'parched before storage, a process that halts germination but also makes the grain unsuitable for ' +
          'planting the following season. The quantity stored far exceeded what the settlement\'s estimated ' +
          'population would consume in a year. This combination of facts suggests that the grain ______',
    stem: 'Which choice most logically completes the text?',
    correct: 'was intended for exchange with other settlements rather than for the community\'s own consumption or sowing.',
    wrong: ['had spoiled before it could be used and was therefore discarded away from the dwellings.',
            'was the settlement\'s entire harvest for that year, stored in a single location for safety.',
            'was parched by accident during a fire that swept through the settlement.']
  },
  {
    skill: 'text-structure', difficulty: 'medium',
    text: 'Coral reefs are frequently described as the rainforests of the sea, a comparison that captures ' +
          'their biodiversity but obscures an important difference. A rainforest\'s structure is built by ' +
          'organisms that are themselves the dominant living tissue; a reef\'s structure is largely the ' +
          'accumulated skeleton of animals long dead. The living coral is a thin veneer over centuries of ' +
          'calcium carbonate. This distinction matters for restoration: replanting a forest and rebuilding ' +
          'a reef are not the same kind of problem.',
    stem: 'Which choice best describes the function of the underlined sentence in the text as a whole?',
    underline: 'The living coral is a thin veneer over centuries of calcium carbonate.',
    correct: 'It clarifies the structural difference the text has just introduced, preparing for the practical conclusion that follows.',
    wrong: ['It introduces a counterargument that the rest of the text goes on to refute.',
            'It provides statistical evidence supporting the comparison between reefs and rainforests.',
            'It restates the text\'s main claim in more technical language.']
  },
  {
    skill: 'text-structure', difficulty: 'hard',
    text: 'The conventional history of the typewriter treats the QWERTY layout as a solution to mechanical ' +
          'jamming: separate the most common letter pairs, and the typebars collide less often. Recent work ' +
          'on the machine\'s early commercial history complicates that story. The layout appears to have ' +
          'been adjusted repeatedly in response to telegraph operators, who were among the first heavy ' +
          'users and who transcribed Morse code rather than ordinary prose. Whatever its mechanical logic, ' +
          'the arrangement was shaped by a workflow most later users never performed.',
    stem: 'Which choice best states the main purpose of the text?',
    correct: 'To present a widely held explanation and then argue that it is incomplete in light of newer evidence.',
    wrong: ['To demonstrate that the QWERTY layout was never intended to prevent mechanical jamming.',
            'To argue that telegraph operators should be credited with inventing the typewriter.',
            'To describe the technical mechanism by which early typewriters jammed.']
  },
  {
    skill: 'command-of-evidence', difficulty: 'hard',
    text: 'Ecologists have proposed that the reintroduction of wolves to a valley altered the course of its ' +
          'river. The argument runs that wolves reduced elk browsing along the banks, allowing willow and ' +
          'aspen to recover, which in turn stabilised the soil and narrowed the channel. Critics note that ' +
          'the same period saw a marked change in regional rainfall, which could independently explain the ' +
          'channel\'s narrowing.',
    stem: 'Which finding, if true, would most directly support the ecologists\' proposed explanation?',
    correct: 'In a nearby valley with similar rainfall changes but no wolves, elk browsing continued and the river channel did not narrow.',
    wrong: ['Rainfall across the region declined steadily throughout the period of the study.',
            'Willow and aspen recover quickly along riverbanks wherever browsing pressure is reduced.',
            'Wolf populations in the valley grew more slowly than ecologists had initially predicted.']
  },
  {
    skill: 'command-of-evidence', difficulty: 'hard',
    text: 'A materials scientist hypothesised that the exceptional durability of a particular Roman concrete ' +
          'comes from lime clasts — small white inclusions long dismissed as evidence of sloppy mixing. She ' +
          'proposed that when a crack forms and water enters, the clasts dissolve and recrystallise, sealing ' +
          'the crack. She was unable to determine, however, whether this happens quickly enough to matter.',
    stem: 'Which finding, if true, would most directly support the scientist\'s hypothesis?',
    correct: 'Cracked samples containing lime clasts sealed completely within two weeks of water exposure, while samples without clasts did not seal at all.',
    wrong: ['Roman concrete structures have survived in marine environments for two thousand years.',
            'Lime clasts are present in concrete from many Roman sites across the Mediterranean.',
            'Modern concrete formulations do not contain lime clasts of the kind found in Roman samples.']
  },
  {
    skill: 'cross-text', difficulty: 'hard',
    text1: 'Text 1: Analysing tree rings from timbers in surviving medieval buildings, one research group ' +
           'concluded that a sustained cooling beginning around 1300 was the primary driver of the period\'s ' +
           'widespread crop failures. The correspondence between the coldest rings and the recorded famines ' +
           'is, they argue, too close to be coincidental.',
    text2: 'Text 2: Historian Ines Adarve does not dispute the tree-ring record but cautions against reading ' +
           'it as a sufficient explanation. Regions with nearly identical climate signals, she observes, ' +
           'experienced very different outcomes — some suffered catastrophic famine while others did not. ' +
           'The difference, she argues, lay in grain storage practice and the reach of local trade networks.',
    stem: 'Based on the texts, how would Adarve (Text 2) most likely respond to the conclusion presented in Text 1?',
    correct: 'By accepting the climate data as accurate but arguing that it cannot by itself account for why famine struck some regions and not others.',
    wrong: ['By disputing the reliability of tree rings as a record of historical temperature.',
            'By agreeing that cooling was the primary driver and adding that trade networks amplified its effects.',
            'By arguing that the famines of the period have been substantially overstated in the historical record.']
  },
  {
    skill: 'cross-text', difficulty: 'hard',
    text1: 'Text 1: A team studying octopus behaviour reported that individuals in their laboratory solved ' +
           'a novel latch puzzle far faster on a second encounter than on a first, and concluded that the ' +
           'animals form durable memories of specific mechanical problems.',
    text2: 'Text 2: Neuroscientist Paul Oyelaran notes that the octopuses in such studies are typically ' +
           'housed in tanks containing similar latch mechanisms. Faster performance on a second trial, he ' +
           'suggests, may reflect growing familiarity with latches in general rather than memory of that ' +
           'particular puzzle. Distinguishing the two would require testing animals with no prior exposure.',
    stem: 'Based on the texts, how would Oyelaran (Text 2) most likely respond to the team\'s conclusion in Text 1?',
    correct: 'By proposing an alternative explanation for the observed improvement and identifying the experiment that would tell the two apart.',
    wrong: ['By rejecting the finding on the grounds that octopuses are incapable of forming memories.',
            'By agreeing with the conclusion and offering additional evidence of octopus problem-solving.',
            'By arguing that the second trial was conducted too soon after the first to be meaningful.']
  },
  {
    skill: 'central-ideas', difficulty: 'medium',
    text: 'Genetic studies of ancient horse remains long supported a single domestication event on the ' +
          'Eurasian steppe. An analysis of more than two hundred ancient genomes complicates that account. ' +
          'It found that horses in several regions were being managed by people well before the steppe ' +
          'lineage spread, but that only the steppe population left descendants. Domestication, on this ' +
          'reading, was attempted repeatedly and took hold once — not because it came first, but because ' +
          'that particular lineage happened to travel well.',
    stem: 'Which choice best states the main idea of the text?',
    correct: 'Genetic evidence indicates that horses were domesticated more than once, though only one lineage ultimately spread.',
    wrong: ['The analysis confirmed that horses were first domesticated on the Eurasian steppe.',
            'Ancient genomes have become the most reliable source of evidence about animal domestication.',
            'Horses domesticated outside the steppe proved poorly suited to human management.']
  },
  {
    skill: 'central-ideas', difficulty: 'hard',
    text: 'The reputation of the still life as a minor genre owes much to a hierarchy formalised by ' +
          'seventeenth-century academies, which ranked painting by subject: history above portraiture, ' +
          'portraiture above landscape, landscape above the arrangement of objects on a table. Recent ' +
          'scholarship argues that this ranking tells us more about the academies\' ambitions than about ' +
          'the work itself. Painters of still life were frequently the most technically demanding ' +
          'practitioners of their generation, and their patrons paid accordingly. The genre was minor by ' +
          'decree rather than by skill or by market.',
    stem: 'Which choice best states the main idea of the text?',
    correct: 'The low status of still life reflects an institutional ranking rather than the genre\'s actual difficulty or value.',
    wrong: ['Seventeenth-century academies ranked painting according to its subject matter.',
            'Still life painters were more technically accomplished than history painters were.',
            'Patrons of the period largely disregarded the hierarchy the academies had established.']
  },
  {
    skill: 'central-ideas', difficulty: 'medium',
    text: 'White-crowned sparrows sing in regional dialects, and these were long assumed to be stable, ' +
          'passed from one generation to the next largely unchanged. A fifty-year recording project ' +
          'around San Francisco Bay shows otherwise. Over that span the local dialect narrowed: the trill ' +
          'that once distinguished several neighbouring populations was gradually replaced by a single ' +
          'version. The researchers attribute the convergence to the loss of the scrub habitat that had ' +
          'kept those populations apart. The dialects were never fixed; they were held in place by geography.',
    stem: 'Which choice best states the main idea of the text?',
    correct: 'Sparrow dialects once thought stable have converged, suggesting they were maintained by physical separation rather than by tradition.',
    wrong: ['White-crowned sparrows around San Francisco Bay have stopped singing in dialects altogether.',
            'Detecting change in bird song requires recordings gathered over at least fifty years.',
            'Habitat loss has sharply reduced the population of white-crowned sparrows in the region.']
  },
  {
    skill: 'inferences', difficulty: 'hard',
    text: 'Deep-sea anglerfish live where prey is so scarce that an individual may encounter a possible ' +
          'mate only once in its life. In several species the male is a fraction of the female\'s size, ' +
          'loses the use of his digestive system on maturity, and fuses permanently to the first female ' +
          'he finds, drawing nutrients from her bloodstream. Because an animal\'s immune system would ' +
          'ordinarily reject foreign tissue joined to it on this scale, biologists studying the ' +
          'arrangement have concluded that ______',
    stem: 'Which choice most logically completes the text?',
    correct: 'the immune defences that normally prevent such a fusion must be greatly reduced in these species.',
    wrong: ['male anglerfish of these species are incapable of surviving on their own at any stage of life.',
            'female anglerfish derive no nutritional benefit from the males fused to them.',
            'anglerfish encounter possible mates far more often than the scarcity of prey would suggest.']
  },
  {
    skill: 'inferences', difficulty: 'hard',
    text: 'A pottery workshop excavated in northern Italy produced vessels in two distinct clay bodies. ' +
          'One is local; the other matches deposits more than three hundred kilometres away. The imported ' +
          'clay appears only in vessels of a single form, and only in the lowest layers of the site. In ' +
          'later layers that same form is made from local clay but fired at a temperature the local ' +
          'material tolerates poorly, producing a high rate of breakage. The pattern suggests that the ' +
          'workshop\'s potters ______',
    stem: 'Which choice most logically completes the text?',
    correct: 'kept using a method developed for the imported clay after they had stopped obtaining it.',
    wrong: ['abandoned the imported clay because it had produced an unacceptable rate of breakage.',
            'were unable to reach the distant deposits during the site\'s earliest period of use.',
            'reserved the imported-clay vessels for a wealthier class of customer than the others.']
  },
  {
    skill: 'inferences', difficulty: 'medium',
    text: 'The efficiency of a solar panel falls as its temperature rises, which is why identical panels ' +
          'generate less power in a desert than in a cool, clear climate. A recent design lays over the ' +
          'cells a thin film that radiates strongly in the mid-infrared. Because the atmosphere is nearly ' +
          'transparent at those wavelengths, heat emitted by the film passes straight out to space instead ' +
          'of warming the air around the panel. Engineers testing the design therefore expect that it will ______',
    stem: 'Which choice most logically completes the text?',
    correct: 'raise output most in hot, dry places, where panel temperature currently costs the most power.',
    wrong: ['increase the total quantity of sunlight the cells are able to absorb.',
            'eliminate the relationship between a panel\'s temperature and its efficiency.',
            'perform best in cool climates, where the atmosphere is most transparent.']
  },
  {
    skill: 'command-of-evidence', difficulty: 'hard',
    text: 'A linguist has proposed that the unusually large vowel inventory of one highland language group ' +
          'arose because its speakers historically communicated across long distances in mountainous ' +
          'terrain, where consonants carry poorly. Vowels survive the journey, she argues, and a language ' +
          'pressed into that use would elaborate them. Critics respond that the inventory may simply have ' +
          'been inherited from a common ancestor that had nothing to do with mountains.',
    stem: 'Which finding, if true, would most directly support the linguist\'s proposal?',
    correct: 'Lowland languages descended from the same ancestor have markedly smaller vowel inventories than their highland relatives do.',
    wrong: ['Vowels are easier to distinguish than consonants at a distance in every language so far studied.',
            'The highland languages have been spoken in their present region for at least two thousand years.',
            'Several unrelated languages spoken in flat terrain also have unusually large vowel inventories.']
  },
  {
    skill: 'command-of-evidence', difficulty: 'hard',
    text: 'An economist argues that a city\'s decision to make its buses free increased employment among ' +
          'residents without cars. Ridership rose sharply after the change, and so did the number of job ' +
          'applications submitted from neighbourhoods far from the commercial district. A colleague ' +
          'objects that the fare change coincided with a regional hiring boom, which could account for ' +
          'the applications on its own.',
    stem: 'Which finding, if true, would most directly support the economist\'s argument?',
    correct: 'In neighbouring cities that shared the hiring boom but kept their fares, applications from outlying neighbourhoods did not rise.',
    wrong: ['Bus ridership in the city rose by more than forty percent in the year after fares were removed.',
            'Residents without cars are more likely than other residents to apply for work outside their own neighbourhood.',
            'The regional hiring boom continued for two years after the fare change took effect.']
  },
  {
    skill: 'text-structure', difficulty: 'hard',
    text: 'The word "quarantine" comes from the Venetian for forty, the number of days a ship was held at ' +
          'anchor before its crew could land. The practice long predates any understanding of contagion. ' +
          'Venice settled on forty days because scripture associated that interval with purification, and ' +
          'it happened to exceed the incubation period of the diseases in question. The policy worked for ' +
          'a reason its authors could not have named. That coincidence has made the episode a favourite of ' +
          'historians arguing that effective public health measures do not require a correct theory of disease.',
    stem: 'Which choice best describes the function of the underlined sentence in the text as a whole?',
    underline: 'The policy worked for a reason its authors could not have named.',
    correct: 'It states the point the preceding history has been building toward and that the final sentence goes on to apply.',
    wrong: ['It introduces a claim that the remainder of the text calls into question.',
            'It supplies the etymological detail on which the text\'s argument depends.',
            'It concedes a limitation of the historical evidence described earlier.']
  },
  {
    skill: 'text-structure', difficulty: 'hard',
    text: 'Most accounts of the Green Revolution measure it in yield: tonnes of wheat and rice per hectare, ' +
          'doubled and doubled again within a generation. The figure is real. It is also incomplete, ' +
          'because the new varieties were bred to respond to irrigation and fertiliser, and the farms able ' +
          'to supply both were rarely the smallest ones. Yield rose fastest where capital was already ' +
          'concentrated. Any assessment that stops at the tonnage is measuring the technology and not its ' +
          'distribution.',
    stem: 'Which choice best states the main purpose of the text?',
    correct: 'To argue that a standard measure of an agricultural transformation leaves out something essential about who benefited from it.',
    wrong: ['To dispute the claim that crop yields rose substantially during the Green Revolution.',
            'To explain the breeding techniques that produced the new varieties of wheat and rice.',
            'To recommend that future crop varieties be bred for farms that lack irrigation.']
  },
  {
    skill: 'cross-text', difficulty: 'hard',
    text1: 'Text 1: A team of archaeologists interprets the standing stones at a northern European site as ' +
           'an astronomical instrument, noting that several alignments point to the midwinter sunrise with ' +
           'an error of less than a degree. Precision of that order, they argue, cannot be accidental.',
    text2: 'Text 2: Statistician Rosa Delacroix accepts the measurements but questions the inference. A site ' +
           'with dozens of stones generates hundreds of possible sightlines, she notes, and among hundreds ' +
           'of lines some will match an astronomical event closely by chance alone. The test she proposes ' +
           'is whether the alignments that do match were built to a higher standard than those that do not.',
    stem: 'Based on the texts, how would Delacroix (Text 2) most likely respond to the archaeologists\' argument in Text 1?',
    correct: 'By granting that the alignments are accurate but arguing that accuracy alone cannot establish intent, and naming a test that could.',
    wrong: ['By disputing the team\'s measurements of the midwinter sunrise alignments.',
            'By agreeing that the alignments were deliberate and suggesting the site served additional astronomical purposes.',
            'By arguing that the stones were erected too late to have been used for astronomical observation.']
  },
  {
    skill: 'cross-text', difficulty: 'hard',
    text1: 'Text 1: Reviewing four decades of studies, a group of psychologists reports that people who ' +
           'describe themselves as night owls score lower on measures of conscientiousness, and suggests ' +
           'that late sleep timing may itself erode the trait.',
    text2: 'Text 2: Ayo Brennan points out that nearly all of the studies in question administered their ' +
           'tests during standard working hours. A night owl tested at nine in the morning is being tested ' +
           'at a personal low. Whether the reported difference reflects a durable trait or merely the hour ' +
           'of the appointment is, on the available evidence, impossible to say.',
    stem: 'Based on the texts, how would Brennan (Text 2) most likely respond to the psychologists\' suggestion in Text 1?',
    correct: 'By identifying a feature of how the studies were conducted that could produce the reported difference without any underlying trait.',
    wrong: ['By arguing that conscientiousness cannot be measured reliably by any psychological test.',
            'By accepting that late sleep timing erodes conscientiousness and proposing a mechanism for the effect.',
            'By presenting evidence that night owls outperform early risers when they are tested in the evening.']
  },
  {
    skill: 'command-of-evidence-quant', difficulty: 'medium',
    text: 'A team compared four insulating materials, measuring the thermal conductivity of each and the ' +
          'installed cost of the thickness a building code requires. They expected the ranking by ' +
          'conductivity and the ranking by cost to track one another, since a less conductive material ' +
          'needs less of itself to do the same job. The figures did not bear that out: ______',
    graphic: {
      type: 'table',
      columns: ['Material', 'Thermal conductivity (W/m*K)', 'Installed cost per sq m ($)'],
      rows: [['Mineral wool', 0.038, 24], ['Rigid foam', 0.022, 61],
             ['Cellulose', 0.040, 19], ['Aerogel panel', 0.014, 210]]
    },
    stem: 'Which choice most effectively uses data from the table to complete the text?',
    correct: 'the aerogel panel, the least conductive of the four, was also by far the most expensive to install.',
    wrong: ['cellulose, the most conductive of the four materials, was also the cheapest to install.',
            'mineral wool and cellulose differ in thermal conductivity by less than 0.005 W/m*K.',
            'rigid foam costs more than twice as much per square metre to install as mineral wool does.']
  },
  {
    skill: 'command-of-evidence-quant', difficulty: 'hard',
    text: 'A team measured how long four species of seed remained viable after being buried in dry soil. ' +
          'They expected viability to decline steadily with seed size, on the theory that larger seeds ' +
          'carry proportionally more of the reserves that degrade over time. The data, however, did not ' +
          'follow that pattern: ______',
    graphic: {
      type: 'table',
      columns: ['Species', 'Mean seed mass (mg)', 'Viability after 10 years (%)'],
      rows: [['Wild oat', 12, 41], ['Field mustard', 3, 78], ['Common vetch', 45, 63], ['Corn poppy', 1, 84]]
    },
    stem: 'Which choice most effectively uses data from the table to complete the text?',
    correct: 'common vetch, the largest seed at 45 mg, retained higher viability after ten years than wild oat, which is roughly four times smaller.',
    wrong: ['corn poppy, the smallest seed at 1 mg, retained the highest viability after ten years.',
            'field mustard and corn poppy, the two smallest seeds, both retained viability above 75 percent.',
            'wild oat retained the lowest viability after ten years, at 41 percent.']
  }
];

/* Which domain each authored passage belongs to. Text Structure and Purpose
   and Cross-Text Connections are Craft and Structure skills; Central Ideas and
   Details, Inferences and Command of Evidence are Information and Ideas. */
const CRAFT_SKILLS = { 'text-structure': 1, 'cross-text': 1 };

function passageDomain(p) {
  return CRAFT_SKILLS[p.skill] ? D_CRAFT : D_INFO;
}

const CRAFT_PASSAGES = PASSAGES.filter((p) => passageDomain(p) === D_CRAFT);
const INFO_PASSAGES  = PASSAGES.filter((p) => passageDomain(p) === D_INFO);

/* Each comprehension skill corresponds to exactly one question type, so the
   passage bank does not have to repeat itself: the qtype is derived from the
   skill the passage already declares. Deriving beats duplicating here - a
   second field on 24 hand-written rows is 24 chances to disagree with the
   first. */
const COMPREHENSION_QTYPE = {
  'central-ideas': 'rw-central-idea',
  'inferences': 'rw-inference',
  'command-of-evidence': 'rw-evidence-textual',
  'command-of-evidence-quant': 'rw-evidence-quantitative',
  'text-structure': 'rw-text-structure',
  'cross-text': 'rw-cross-text'
};

function generateComprehension(rng, diff, pool) {
  const p = rng.pick(pool || PASSAGES);

  let passage;
  if (p.text1) {
    passage = p.text1 + '\n\n' + p.text2;
  } else if (p.underline) {
    // Mark the referenced sentence, since the renderer has no underline.
    passage = p.text.replace(p.underline, '>> ' + p.underline + ' <<');
  } else {
    passage = p.text;
  }

  const qt = COMPREHENSION_QTYPE[p.skill];
  if (!qt) {
    console.warn('[sat] passage skill "' + p.skill + '" has no question type mapping');
  }

  return makeMC(rng, {
    section: 'rw', domain: passageDomain(p), skill: p.skill, qtype: qt || null,
    difficulty: p.difficulty || diff,
    passage,
    graphic: p.graphic || null,
    stem: p.underline
      ? p.stem + '\n(The sentence in question is marked >> like this <<.)'
      : p.stem,
    correct: p.correct,
    distractors: p.wrong.map((w) => ({ v: w, why: comprehensionWhy(p.skill) })),
    explanation: p.explanation ||
      'The correct choice is the one the text actually supports, at the level of ' +
      'generality the question asks for.'
  });
}

/* Why a wrong comprehension choice is wrong.

   This one is per SKILL, not per option, and that is a real difference from
   everything else in this file. A grammar distractor commits a named error and
   a wrong vocabulary word clashes with a stated signal - both can be pinned
   exactly. A wrong reading-comprehension option is wrong because of what a
   whole paragraph means, and there is no rule that derives that.

   So this says the next most useful true thing: the failure mode this question
   type is built around. Every wrong option on a central-idea question really is
   too narrow, too broad, or unsupported, and telling a student which three
   things to check is worth considerably more than a blank panel. Where a
   passage carries its own explanation, that is shown alongside this.

   If these are ever replaced with per-option reasons, the coverage sweep will
   not notice - it only counts whether a reason exists. Judge them by reading
   them, not by the percentage. */
const COMPREHENSION_WHY = {
  'central-ideas':
    'Main-idea options fail in three ways: too narrow (true of one sentence but not the text), ' +
    'too broad (a general claim the text never quite makes), or unsupported. Check this one ' +
    'against the WHOLE passage - if any part of the text is not covered by it, it is not the main idea.',
  'inferences':
    'An inference has to follow from the text and go no further. This option either adds ' +
    'something the passage never establishes, or reverses a relationship it does state. Ask what ' +
    'sentence would have to be true for this to hold, then look for that sentence.',
  'command-of-evidence':
    'The question is not which statement is true but which one WOULD SUPPORT the claim. ' +
    'An option can be perfectly accurate and still support nothing. Ask whether this makes the ' +
    'specific claim in the stem more likely, or merely sits next to it.',
  'command-of-evidence-quant':
    'Data options fail by reading the wrong row or column, by describing a real number that is ' +
    'irrelevant to the claim, or by stating a trend the figures do not show. Go back to the ' +
    'table and find the exact numbers this sentence would need.',
  'text-structure':
    'This describes a job the sentence does not do. Read the sentence before it and the sentence ' +
    'after: a function claim has to fit what actually surrounds it, not what the sentence says ' +
    'in isolation.',
  'cross-text':
    'The trap here is answering from one text. This option either overstates the disagreement, ' +
    'understates it, or attributes to the second author a position the second text never takes. ' +
    'Find the line in Text 2 that would have to exist for this to be right.',
  'rhetorical-synthesis':
    'The goal stated in the question decides everything. This option may use the notes accurately ' +
    'and still not serve that goal - or it may bring in a bullet the goal does not call for. ' +
    'Reread the goal, then check this sentence against it word for word.'
};

function comprehensionWhy(skill) {
  return COMPREHENSION_WHY[skill] ||
    'Check this against what the text actually states, at the level of generality the question asks for.';
}

/* =========================================================== registry

   The College Board publishes the domain split for a Reading and Writing
   section as: Craft and Structure 28%, Information and Ideas 26%, Standard
   English Conventions 26%, Expression of Ideas 20%.

   The comment above this table used to claim exactly those figures while the
   weights below produced something quite different, because one entry -
   generateComprehension - fed TWO domains and the split between them was
   whatever the passage bank happened to contain. Measured over 1500 questions
   the real output was Conventions 36%, Craft 29%, Expression 22%, Information
   12%: a student practising here got three times as much punctuation as the
   real test gives them and half the reading comprehension. Every number in the
   comment was right and the test was still wrong.

   So the comprehension generator is now split in two, one entry per domain,
   and every weight below is a direct percentage that sums to 100. The domain
   totals are recomputed and asserted at load, which is the part that can
   actually fail. */

const GENERATORS = [
  // Craft and Structure - 28
  { w: 16, d: D_CRAFT, fn: generateWordsInContext },
  { w: 12, d: D_CRAFT, fn: (rng, diff) => generateComprehension(rng, diff, CRAFT_PASSAGES) },

  // Information and Ideas - 26
  { w: 26, d: D_INFO,  fn: (rng, diff) => generateComprehension(rng, diff, INFO_PASSAGES) },

  // Standard English Conventions - 26
  { w: 6, d: D_CONV, fn: generateBoundaries },
  { w: 3, d: D_CONV, fn: generateAppositive },
  { w: 6, d: D_CONV, fn: generateSubjectVerbAgreement },
  { w: 4, d: D_CONV, fn: generatePossessive },
  { w: 3, d: D_CONV, fn: generatePronounAgreement },
  { w: 2, d: D_CONV, fn: generateModifier },
  { w: 2, d: D_CONV, fn: generateTense },

  // Expression of Ideas - 20
  { w: 13, d: D_EXPR, fn: generateTransition },
  { w: 7,  d: D_EXPR, fn: generateSynthesis }
];

/* The published target, and the check that the table above actually hits it.
   A warning here is the difference between a wrong mix and a wrong mix nobody
   noticed for a month. */
const RW_DOMAIN_TARGET = {
  [D_CRAFT]: 28, [D_INFO]: 26, [D_CONV]: 26, [D_EXPR]: 20
};

(function verifyWeights() {
  const got = {};
  let total = 0;
  for (const g of GENERATORS) { got[g.d] = (got[g.d] || 0) + g.w; total += g.w; }
  const bad = [];
  if (total !== 100) bad.push('weights sum to ' + total + ', not 100');
  for (const k of Object.keys(RW_DOMAIN_TARGET)) {
    if (got[k] !== RW_DOMAIN_TARGET[k]) {
      bad.push(k + ' is ' + (got[k] || 0) + '%, published share is ' + RW_DOMAIN_TARGET[k] + '%');
    }
  }
  if (bad.length) console.warn('[sat] R&W domain mix is off spec: ' + bad.join('; '));
})();

function generate(rng, difficulty) {
  return SATG.satUtil.generateFrom(rng, GENERATORS, {
    difficulty: difficulty, bank: 'rw', fallback: generateTransition
  });
}

/* Same draw, restricted to one content domain - what a module test needs to
   hit the published domain quota exactly rather than on average. */
function generateInDomain(rng, difficulty, domain) {
  return SATG.satUtil.generateFrom(rng, GENERATORS, {
    difficulty: difficulty, domain: domain, bank: 'rw', fallback: generateTransition
  });
}

SATG.verbalQuestions = {
  generate, generateInDomain, GENERATORS, RW_DOMAIN_TARGET,
  domains: { D_CRAFT, D_INFO, D_CONV, D_EXPR },
  banks: { TRANSITION_PAIRS, CLAUSE_PAIRS, VOCAB_ITEMS, SYNTHESIS_TOPICS, PASSAGES,
           CRAFT_PASSAGES, INFO_PASSAGES }
};

})(window);
