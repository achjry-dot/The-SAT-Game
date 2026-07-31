/* =========================================================================
   config.js - the handful of settings that are yours to fill in.

   Everything here is optional. With all of it blank the game runs exactly as
   it does now; the FEEDBACK menu item simply falls back to opening a mail
   client instead of posting to Discord.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG || (global.SATG = {});

SATG.CONFIG = {

  /* ----------------------------------------------------------- Discord

     Paste a Discord WEBHOOK url here and the FEEDBACK screen posts straight
     into that channel.

     To get one:
       Discord -> right-click your server -> Server Settings
               -> Integrations -> Webhooks -> New Webhook
               -> choose the channel -> Copy Webhook URL

     It looks like:
       https://discord.com/api/webhooks/1234567890/AbCdEf...

     A webhook, NOT a bot. A bot needs a token, a process running somewhere
     around the clock, and permissions to manage; it exists so software can
     read messages and react to them. Nothing here needs to read anything, so
     all of that would be cost with no benefit.

     ---- READ THIS BEFORE YOU PASTE ----

     This game is a static site with no server of its own, so whatever goes in
     this file is downloaded by every player and is visible in the page
     source. On a public repository, treat this url as public.

     What someone who finds it can do: post messages into that one channel.
     What they cannot do: read the channel, see other channels, touch members,
     or do anything else in the server - a webhook is send-only, to a single
     destination.

     So point it at a channel created for this and nothing else. If it is ever
     abused, delete the webhook in the same settings page and make a new one;
     the old url dies instantly.

     If you would rather the url stay secret, put a small serverless function
     (Cloudflare Workers and Vercel both have free tiers) in front of it and
     paste THAT url here instead. The game does not care which it is talking
     to - same request either way - so you can switch later without touching
     any other code. */
  feedbackWebhook: 'https://discord.com/api/webhooks/1532710409985855598/yvkOprRG6yobbhrIEkXp6h_gztj--laQiReY438yWCibvWOhpuBOHtaByjo3U3jD8qMe',

  /* ------------------------------------------------------------- email

     Used when feedbackWebhook is empty, or when posting to it fails - the
     FEEDBACK screen offers to open a mail client instead, so a player is
     never left with no way to reach you. */
  feedbackEmail: 'cherytakessouls@gmail.com',

  /* Longest message the feedback box accepts. Discord embed descriptions
     stop at 4096 characters; this leaves generous room under that once the
     diagnostic fields are added. */
  feedbackMaxChars: 900,

  /* Seconds between sends, to stop a stuck key or an impatient player from
     firing the same report a dozen times. */
  feedbackCooldown: 20
};

})(window);
