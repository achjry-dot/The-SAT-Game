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
  const distractors = wrongFamilies.map((f) => rng.pick(TRANSITION_FAMILIES[f]));

  const relWord = {
    contrast: 'the second sentence qualifies or opposes the first',
    cause: 'the second sentence states a consequence of the first',
    addition: 'the second sentence adds a further point of the same kind',
    example: 'the second sentence gives a specific instance of the first'
  }[pair.rel];

  return makeMC(rng, {
    section: 'rw', domain: D_EXPR, skill: 'transitions', difficulty: diff,
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

const CLAUSE_PAIRS = [
  { a: 'The observatory sits on a ridge above the treeline',
    b: 'its dome is visible from the valley floor on clear nights' },
  { a: 'Glassblowing requires constant rotation of the pipe',
    b: 'gravity would otherwise pull the molten form out of true' },
  { a: 'The manuscript had been stored in a damp cellar for decades',
    b: 'several of its pages were beyond restoration' },
  { a: 'Arctic terns migrate farther than any other bird',
    b: 'some individuals cover more than seventy thousand kilometres each year' },
  { a: 'The factory once produced textile machinery for the entire region',
    b: 'it now houses a museum and a series of workshops' },
  { a: 'Soil samples from the site contained an unusual concentration of iron',
    b: 'the surrounding bedrock offered no obvious source for it' },
  { a: 'The composer wrote the quartet in less than three weeks',
    b: 'she revised it steadily for the next eleven years' },
  { a: 'Tidal pools support an unusually dense range of species',
    b: 'the organisms living there must tolerate sharp swings in temperature and salinity' },
  { a: 'The railway line was abandoned in the early 1960s',
    b: 'much of the original track bed remains intact' },
  { a: 'Lichens grow extremely slowly on exposed rock',
    b: 'their size can be used to estimate how long a surface has been uncovered' },
  { a: 'The printing house kept detailed records of every order it filled',
    b: 'those ledgers now provide a rare picture of the period\'s reading habits' },
  { a: 'Desert nights cool rapidly after sunset',
    b: 'the dry air holds very little of the day\'s accumulated heat' },
  { a: 'The sculpture was cast in a single pour',
    b: 'no seams are visible anywhere on its surface' },
  { a: 'Researchers tagged forty individual whales over two seasons',
    b: 'only nine of the tags transmitted for the full duration of the study' },
  { a: 'The city rebuilt its seawall after the 1938 storm',
    b: 'the new structure was designed to absorb wave energy rather than deflect it' },
  { a: 'Handmade paper draws its strength from the length of its fibres',
    b: 'industrial pulping shortens those fibres considerably' }
];

function generateBoundaries(rng, diff) {
  const pair = rng.pick(CLAUSE_PAIRS);
  const a = pair.a, b = pair.b;
  const bCap = b.charAt(0).toUpperCase() + b.slice(1);

  // Which correct join to present. All three are legitimate; the distractors
  // are built around whichever one is chosen.
  const style = rng.pick(['period', 'semicolon', 'commaFanboys']);
  const conj = rng.pick(['and', 'but', 'so']);

  let correct, explanation;
  if (style === 'period') {
    correct = a + '. ' + bCap + '.';
    explanation = 'Two independent clauses may be separated by a period.';
  } else if (style === 'semicolon') {
    correct = a + '; ' + b + '.';
    explanation = 'A semicolon correctly joins two closely related independent clauses.';
  } else {
    correct = a + ', ' + conj + ' ' + b + '.';
    explanation = 'A comma plus a coordinating conjunction correctly joins two independent clauses.';
  }

  // Each distractor is exactly one named error.
  const distractors = [
    a + ', ' + b + '.',                       // comma splice
    a + ' ' + b + '.',                        // fused / run-on sentence
    a + ': ' + b + '.'                        // colon where no list or elaboration follows
  ];
  if (style === 'semicolon') {
    distractors[2] = a + '; and ' + b + '.';  // semicolon plus conjunction
  }

  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'boundaries', difficulty: diff,
    passage: null,
    stem: STEM_CONVENTIONS + '\n\nWhich version correctly joins these two ideas?',
    correct, distractors,
    explanation: explanation +
      ' A comma alone creates a comma splice, no punctuation creates a run-on, ' +
      'and a colon requires that what follows explain or list something.'
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
    section: 'rw', domain: D_CONV, skill: 'boundaries', difficulty: diff,
    stem: STEM_CONVENTIONS,
    correct,
    distractors: [
      it.subj + ', ' + it.app + ' - ' + it.rest + '.',   // mismatched pair
      it.subj + ', ' + it.app + ' ' + it.rest + '.',     // opened but never closed
      it.subj + ' ' + it.app + ', ' + it.rest + '.'      // closed but never opened
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

  // Three wrong choices: the proximity error plus two tense/aspect errors.
  const distractors = [wrong];
  if (correct === 'is')       distractors.push('were', 'being');
  else if (correct === 'are') distractors.push('was', 'being');
  else if (correct === 'has') distractors.push('have been', 'having');
  else if (correct === 'have')distractors.push('has been', 'having');
  else if (correct === 'were')distractors.push('is', 'being');
  else if (correct === 'was') distractors.push('are', 'being');
  else distractors.push(correct.replace(/s$/, '') + 'ing', 'to ' + correct.replace(/s$/, ''));

  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', difficulty: diff,
    passage: it.subj + ' ' + it.phrase + ' ______ ' + it.rest + '.',
    stem: STEM_CONVENTIONS,
    correct, distractors,
    explanation: 'The subject is "' + it.subj.toLowerCase() + '", which is ' +
                 (it.plural ? 'plural' : 'singular') + '. The phrase "' + it.phrase +
                 '" sits between the subject and the verb but does not change what the verb must agree with.'
  });
}

/* Pronoun-antecedent agreement. */
const PRONOUN_ITEMS = [
  { ante: 'Each of the researchers', correct: 'their own', wrong: ['his or her own', 'its own', 'they own'],
    rest: 'notebook to the site', singular: true,
    note: '"Each" is grammatically singular, but modern usage and the College Board both accept singular "their".' },
  { ante: 'The committee', correct: 'its', wrong: ['their', 'it\'s', 'they\'re'],
    rest: 'recommendation to the council', singular: true,
    note: 'A collective noun acting as a single body takes a singular pronoun.' },
  { ante: 'Neither of the two prototypes', correct: 'its', wrong: ['their', 'it\'s', 'those'],
    rest: 'target weight', singular: true,
    note: '"Neither" is singular, so the pronoun referring back to it must be singular.' },
  { ante: 'The volunteers', correct: 'their', wrong: ['its', 'his', 'there'],
    rest: 'equipment before the survey began', singular: false,
    note: '"Volunteers" is plural and takes a plural pronoun.' }
];

function generatePronounAgreement(rng, diff) {
  const it = rng.pick(PRONOUN_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', difficulty: diff,
    passage: it.ante + ' submitted ______ ' + it.rest + '.',
    stem: STEM_CONVENTIONS,
    correct: it.correct, distractors: it.wrong,
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

function generatePossessive(rng, diff) {
  const it = rng.pick(POSSESSIVE_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', difficulty: diff,
    passage: it.frame,
    stem: STEM_CONVENTIONS,
    correct: it.correct, distractors: it.wrong,
    explanation: it.note
  });
}

/* Dangling and misplaced modifiers. */
const MODIFIER_ITEMS = [
  { opener: 'Having been sealed for three centuries',
    correct: 'the chamber contained air of a markedly different composition',
    wrong: ['researchers found the chamber\'s air markedly different',
            'the composition of the air was markedly different to researchers',
            'it was found that the air had a markedly different composition'],
    note: 'The opening phrase describes the chamber, so "the chamber" must be the subject of the main clause.' },
  { opener: 'Trained to detect a single scent among hundreds',
    correct: 'the dogs located the sample within minutes',
    wrong: ['the sample was located by the dogs within minutes',
            'it took the dogs only minutes to locate the sample',
            'locating the sample took the dogs only minutes'],
    note: 'The modifier describes the dogs, so "the dogs" must follow it directly as the subject.' },
  { opener: 'Written entirely in the margins of a printed almanac',
    correct: 'the diary escaped the attention of censors for years',
    wrong: ['censors overlooked the diary for years',
            'no censor noticed the diary for years',
            'it was years before censors noticed the diary'],
    note: 'The opening phrase describes the diary, which must therefore be the subject of the main clause.' }
];

function generateModifier(rng, diff) {
  const it = rng.pick(MODIFIER_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', difficulty: diff,
    passage: it.opener + ', ______.',
    stem: STEM_CONVENTIONS,
    correct: it.correct, distractors: it.wrong,
    explanation: it.note + ' The other choices leave the opening phrase dangling, ' +
                 'attached to a subject it cannot logically describe.'
  });
}

/* Verb tense driven by an explicit time signal. */
const TENSE_ITEMS = [
  { frame: 'By the time the survey team arrived in 1974, the glacier ______ nearly a kilometre.',
    correct: 'had retreated', wrong: ['has retreated', 'retreats', 'will have retreated'],
    note: 'An action completed before another past event takes the past perfect.' },
  { frame: 'Since the restoration began in 2019, conservators ______ more than sixty panels.',
    correct: 'have treated', wrong: ['treated', 'had treated', 'will treat'],
    note: '"Since" with a period continuing into the present calls for the present perfect.' },
  { frame: 'Next spring the institute ______ a second expedition to the same valley.',
    correct: 'will send', wrong: ['sent', 'has sent', 'had sent'],
    note: 'A stated future time requires a future-tense verb.' },
  { frame: 'The kiln reached its peak temperature at dawn and ______ steadily for two days afterward.',
    correct: 'cooled', wrong: ['cools', 'has cooled', 'will cool'],
    note: 'The two verbs describe the same completed past sequence, so both must be simple past.' }
];

function generateTense(rng, diff) {
  const it = rng.pick(TENSE_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CONV, skill: 'form-structure-sense', difficulty: diff,
    passage: it.frame,
    stem: STEM_CONVENTIONS,
    correct: it.correct, distractors: it.wrong,
    explanation: it.note
  });
}

/* =========================================================================
   4. WORDS IN CONTEXT  (template + authored bank)
   Each entry supplies its own vetted distractor set: a register mismatch,
   a related-but-wrong sense, and a common confusable.
   ========================================================================= */

const VOCAB_ITEMS = [
  { frame: 'Although the theory was initially dismissed, decades of subsequent evidence have ______ its central claim.',
    correct: 'corroborated', wrong: ['fabricated', 'complicated', 'tolerated'] },
  { frame: 'The report is deliberately ______: it states the findings plainly and offers no interpretation whatsoever.',
    correct: 'austere', wrong: ['ornate', 'evasive', 'exhaustive'] },
  { frame: 'Far from being uniform, the sediment layers proved remarkably ______, varying in composition every few centimetres.',
    correct: 'heterogeneous', wrong: ['homogeneous', 'permeable', 'sedimentary'] },
  { frame: 'The committee\'s support was ______ rather than wholehearted; several members signed only after long hesitation.',
    correct: 'tepid', wrong: ['fervent', 'unanimous', 'hostile'] },
  { frame: 'Her prose is ______, conveying in a single clause what other writers labour over for a paragraph.',
    correct: 'economical', wrong: ['verbose', 'affordable', 'ambiguous'] },
  { frame: 'The artist rejected the label entirely, insisting that her work ______ any single tradition.',
    correct: 'transcends', wrong: ['imitates', 'establishes', 'descends'] },
  { frame: 'Because the samples had been stored improperly, the results of the earlier analysis are now considered ______.',
    correct: 'unreliable', wrong: ['definitive', 'unavailable', 'unpopular'] },
  { frame: 'The compound remains ______ at room temperature, decomposing only when heated past 400 degrees.',
    correct: 'stable', wrong: ['volatile', 'soluble', 'abundant'] },
  { frame: 'Rather than settling the debate, the new data ______ it, raising questions no one had thought to ask.',
    correct: 'reinvigorated', wrong: ['resolved', 'summarised', 'abandoned'] },
  { frame: 'The building\'s design is unapologetically ______, borrowing freely from four centuries of architecture.',
    correct: 'eclectic', wrong: ['austere', 'derivative', 'symmetrical'] },
  { frame: 'His account of the expedition is valuable precisely because it is so ______, recording failures alongside successes.',
    correct: 'candid', wrong: ['flattering', 'concise', 'technical'] },
  { frame: 'The population decline was not sudden but ______, unfolding over nearly two hundred years.',
    correct: 'gradual', wrong: ['abrupt', 'severe', 'reversible'] },
  { frame: 'Critics found the argument ______: it assumed at the outset the very conclusion it claimed to prove.',
    correct: 'circular', wrong: ['persuasive', 'lengthy', 'original'] },
  { frame: 'The treaty\'s language is intentionally ______, allowing each signatory to interpret its terms favourably.',
    correct: 'ambiguous', wrong: ['precise', 'archaic', 'binding'] },
  { frame: 'Once ______ across the entire continent, the species now survives in three isolated valleys.',
    correct: 'ubiquitous', wrong: ['endangered', 'nocturnal', 'introduced'] },
  { frame: 'The editor\'s changes were largely ______, correcting spelling without altering the argument.',
    correct: 'superficial', wrong: ['substantive', 'careless', 'controversial'] },
  { frame: 'Given how little of the structure survives, any reconstruction must remain ______.',
    correct: 'conjectural', wrong: ['authoritative', 'expensive', 'permanent'] },
  { frame: 'The two accounts are not merely different but ______: if one is accurate, the other cannot be.',
    correct: 'incompatible', wrong: ['complementary', 'comparable', 'inconsistent'] },
  { frame: 'The instrument is sensitive enough to detect ______ shifts that earlier equipment would have missed entirely.',
    correct: 'minute', wrong: ['immense', 'gradual', 'temporary'] },
  { frame: 'Her influence on the field is difficult to ______, since so much later work simply assumes her framework.',
    correct: 'overstate', wrong: ['establish', 'understand', 'appreciate'] },
  { frame: 'The colony persists in conditions that would prove ______ to almost any other organism.',
    correct: 'lethal', wrong: ['agreeable', 'temporary', 'unfamiliar'] },
  { frame: 'What appears at first to be decorative is in fact ______: every mark records a measurement.',
    correct: 'functional', wrong: ['ornamental', 'illegible', 'accidental'] },
  { frame: 'The author is careful to ______ her claim, noting that it applies only to the earliest period.',
    correct: 'qualify', wrong: ['abandon', 'exaggerate', 'restate'] },
  { frame: 'Rather than a single catastrophe, the collapse was the ______ result of many small failures.',
    correct: 'cumulative', wrong: ['immediate', 'accidental', 'predictable'] }
];

function generateWordsInContext(rng, diff) {
  const it = rng.pick(VOCAB_ITEMS);
  return makeMC(rng, {
    section: 'rw', domain: D_CRAFT, skill: 'words-in-context', difficulty: diff,
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
    section: 'rw', domain: D_EXPR, skill: 'rhetorical-synthesis', difficulty: 'hard',
    passage: 'While researching a topic, a student has taken the following notes:\n\n' + notes,
    stem: 'The student wants to ' + g.goal + '. Which choice most effectively uses ' +
          'relevant information from the notes to accomplish this goal?',
    correct: g.correct, distractors: g.wrong.slice(),
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

function generateComprehension(rng, diff) {
  const p = rng.pick(PASSAGES);

  let passage;
  if (p.text1) {
    passage = p.text1 + '\n\n' + p.text2;
  } else if (p.underline) {
    // Mark the referenced sentence, since the renderer has no underline.
    passage = p.text.replace(p.underline, '>> ' + p.underline + ' <<');
  } else {
    passage = p.text;
  }

  const domain = (p.skill === 'text-structure' || p.skill === 'cross-text') ? D_CRAFT : D_INFO;

  return makeMC(rng, {
    section: 'rw', domain, skill: p.skill, difficulty: p.difficulty || diff,
    passage,
    graphic: p.graphic || null,
    stem: p.underline
      ? p.stem + '\n(The sentence in question is marked >> like this <<.)'
      : p.stem,
    correct: p.correct, distractors: p.wrong.slice(),
    explanation: p.explanation ||
      'The correct choice is the one the text actually supports, at the level of ' +
      'generality the question asks for.'
  });
}

/* =========================================================== registry
   Weights follow the real domain split:
     Craft and Structure 28, Information and Ideas 26,
     Standard English Conventions 26, Expression of Ideas 20.        */

const GENERATORS = [
  // Craft and Structure - 28
  { w: 14, fn: generateWordsInContext },
  { w: 14, fn: generateComprehension },   // also supplies Information and Ideas

  // Standard English Conventions - 26
  { w: 7, fn: generateBoundaries },
  { w: 4, fn: generateAppositive },
  { w: 6, fn: generateSubjectVerbAgreement },
  { w: 4, fn: generatePossessive },
  { w: 3, fn: generatePronounAgreement },
  { w: 3, fn: generateModifier },
  { w: 3, fn: generateTense },

  // Expression of Ideas - 20
  { w: 11, fn: generateTransition },
  { w: 6, fn: generateSynthesis }
];

function generate(rng, difficulty) {
  const pick = rng.weighted(GENERATORS);
  try {
    return pick.fn(rng, difficulty || 'medium');
  } catch (err) {
    console.warn('[sat] verbal generator failed, falling back:', err);
    return generateTransition(rng, difficulty || 'medium');
  }
}

SATG.verbalQuestions = {
  generate, GENERATORS,
  banks: { TRANSITION_PAIRS, CLAUSE_PAIRS, VOCAB_ITEMS, SYNTHESIS_TOPICS, PASSAGES }
};

})(window);
