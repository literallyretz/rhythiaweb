#!/usr/bin/env python3
# Tiny static server (python3 serve.py [port]) with correct MIME types for ES modules / audio / obj.
import http.server, socketserver, sys, mimetypes
mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('audio/mpeg', '.mp3')
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', port), H) as s: print(f'http://localhost:{port}/'); s.serve_forever()
