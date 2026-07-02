---
name: Session cookies require HTTPS in curl/API smoke tests
description: express-session cookie config uses secure:true + sameSite:"none", so curl against localhost:80 (http) silently never receives the Set-Cookie header.
---

# Session cookies require HTTPS for manual/curl testing

The shared session cookie config sets `secure: true, sameSite: "none"`. Browsers
satisfy `secure` automatically because the dev preview iframe is proxied over
HTTPS, but a bash `curl` hitting `http://localhost:80/...` will get a 200 login
response with **no** `Set-Cookie` header at all (silently dropped, no error).
Any subsequent authenticated request then fails with 401 "Not authenticated",
which looks like a login bug but isn't.

**Why:** Wasted a debugging cycle where login "worked" (200, correct user JSON)
but the magnet-check endpoint the resulting cookie was used for kept 401ing —
turned out the cookie jar was empty.

**How to apply:** For any curl/API smoke test that needs an authenticated
session, hit `https://$REPLIT_DEV_DOMAIN/...` (not `localhost:80`) for the
login request so the secure cookie actually gets set and saved to the cookie
jar.
