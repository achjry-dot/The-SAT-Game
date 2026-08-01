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
  feedbackCooldown: 20,

  /* -------------------------------------------------- Google sign-in

     Paste a Google OAuth CLIENT ID here to turn on the STATS page's sign-in.
     Leave it blank and the page still works - it keeps one anonymous record in
     this browser and says so.

     To get one, at https://console.cloud.google.com/ :

       1. Create a project (any name).
       2. APIs & Services -> OAuth consent screen.
          User type: External. Fill in app name, your email, and save.
          While it is in "Testing", only accounts you add under
          "Test users" can sign in - add your own there.
       3. APIs & Services -> Credentials -> Create Credentials
          -> OAuth client ID -> Application type: Web application.
       4. Under "Authorized JavaScript origins" add the address the game is
          served from, with no path and no trailing slash:

            https://YOURNAME.github.io          <- GitHub Pages
            http://localhost:5510               <- the local test server

       5. Copy the Client ID. It ends in .apps.googleusercontent.com

     Two things that will otherwise waste your afternoon:

       file:// is NOT a valid origin, and Google will not accept it. Opening
       index.html by double-clicking gives you the page with sign-in switched
       off and a line saying so. It works on the hosted address.

       The CLIENT ID is public by design - it is meant to be read by every
       visitor and it is safe in this file. The client SECRET on the same
       screen is not, and nothing here needs it. Do not paste that one.

     Signing in decides WHICH record on this machine is yours. It does not move
     your statistics anywhere: they stay in this browser, so signing in on a
     different device starts an empty history. */
  googleClientId: ''
};

})(window);
