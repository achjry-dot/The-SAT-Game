# Music goes here

Everything else you hear in this game is synthesised at runtime by
`src/audio/audio.js` — the room tone, the ding, the gunshot, the ten-second
crescendo. There are no sound files anywhere, which is why the game runs by
double-clicking `index.html`.

Music is the one exception. Compose it, export it, drop it in this folder.

## Three steps

**1. Export from your DAW into this folder.**

```
assets/music/menu.ogg
```

**2. Name it in `src/config.js`**, in the `music.tracks` block near the bottom:

```js
music: {
  tracks: {
    menu:    'assets/music/menu.ogg',
    exam:    '',
    results: ''
  },
  volume: 0.55,
  fade:   1.2
}
```

**3. Reload.** The music starts on your first click — no browser will play
audio before the page has been touched once, so the title card is silent for
that first moment no matter what.

## The three slots

| Slot | Where it plays |
|---|---|
| `menu` | The title card and everything reached from it — SETTINGS, STATS, FEEDBACK, the question-type picker |
| `exam` | Under the room tone during the test. **Empty on purpose** — the ambience and the ten-second cue were written to own that space |
| `results` | The score screen and the full analysis |

A slot left as `''` means that screen has no music, exactly as it is today.
Nothing breaks, nothing is logged.

A slot also takes a list, tried in order until one plays:

```js
menu: ['assets/music/menu.ogg', 'assets/music/menu.mp3']
```

## Format — the one thing worth knowing

**Use OGG or WAV for anything that loops.**

MP3 cannot loop cleanly, ever. The format pads the beginning and end of every
file with a few milliseconds of silence that the encoder inserts and the
decoder cannot fully strip. Your loop will tick once per pass. This is a
property of MP3 itself — no code in this game can fix it.

- **OGG Vorbis** — no padding, small files. Best choice. Every browser except Safari.
- **WAV** — no padding, perfect quality, roughly ten times the size. Works everywhere.
- **MP3 / M4A / FLAC** — fine for anything that does not loop.

If Safari matters to you, list WAV as a second candidate after the OGG.

## Length

Anything from 30 seconds up. It repeats seamlessly, so a short piece that loops
well beats a long one that does not — write the last bar so it leads back into
the first.

## Levels

Mix it quieter than feels right in the DAW. It sits underneath the room tone,
and the ding and the gunshot have to cut through it without a fight. `volume`
in the config is a further scale on top of the SETTINGS master slider; 0.55 is
a starting point, not a rule.

Leave headroom — do not master it to brickwall loudness. The gunshot is
supposed to be the loudest thing in this game.

## Where the code is

`src/audio/music.js`. The header explains why it uses an `<audio>` element
rather than the Web Audio graph everything else runs through: on a `file://`
page the graph would play your track as **silence**, with no error anywhere.
