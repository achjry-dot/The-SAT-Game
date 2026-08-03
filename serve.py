#!/usr/bin/env python3
"""
Local development server for THE SAT GAME.

    python serve.py            # http://localhost:5510
    python serve.py 8080       # pick a port

The only thing this adds over `python -m http.server` is aggressive
no-caching. That matters more than it sounds: the stock server sends
Last-Modified, browsers then reuse cached copies of the .js files, and you end
up staring at a bug you already fixed. Every response here is marked no-store.

This script is a development convenience only. The game itself is a static
site with no build step and no dependencies - to publish it, upload
index.html and src/ to any static host (Netlify, GitHub Pages, Vercel, S3).
You can also just open index.html directly from disk.
"""

import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Serve relative to this file, so it works from any working directory.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop the validator the base handler adds, or browsers will still
        # revalidate into a 304 and reuse the stale body.
        if keyword.lower() == 'last-modified':
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        # Quiet by default; 404s are still worth seeing.
        if args and len(args) > 1 and str(args[1]) != '200':
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5510
    server = ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler)
    print('THE SAT GAME - serving on http://localhost:%d  (ctrl-c to stop)' % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
        server.server_close()


if __name__ == '__main__':
    main()
