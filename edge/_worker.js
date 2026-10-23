/*
  FARO desk — access gate.

  Pages runs this worker in front of every static asset, so the desk answers only
  to a browser that presented the shared credentials. Nothing about the data
  changes here: the gate either forwards the request to the static assets or
  returns 401 and lets the browser ask for a login.

  Credentials live as Pages secrets (SITE_USER, SITE_PASS), never in this file
  and never in the repo:

      npx wrangler pages secret put SITE_USER --project-name brazilian-banks-desk
      npx wrangler pages secret put SITE_PASS --project-name brazilian-banks-desk

  Rotate by putting the secret again and redeploying — no code change, and the
  old password stops working the moment the new deployment is live.
*/

const encoder = new TextEncoder();

/* Constant-time compare: the loop always touches every byte of both strings. */
function safeEqual(a, b) {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function unauthorized() {
  return new Response('FARO desk — acceso restringido.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="FARO desk", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export default {
  async fetch(request, env) {
    const user = env.SITE_USER;
    const pass = env.SITE_PASS;

    /* A deploy with missing secrets fails closed, never open. */
    if (!user || !pass) {
      return new Response('FARO desk — gate not configured (SITE_USER / SITE_PASS).', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    const header = request.headers.get('Authorization') || '';
    const space = header.indexOf(' ');
    if (space > 0 && header.slice(0, space).toLowerCase() === 'basic') {
      let decoded = '';
      try {
        decoded = atob(header.slice(space + 1).trim());
      } catch (e) {
        decoded = '';
      }
      const colon = decoded.indexOf(':');
      if (colon > 0) {
        const okUser = safeEqual(decoded.slice(0, colon), user);
        const okPass = safeEqual(decoded.slice(colon + 1), pass);
        if (okUser && okPass) return env.ASSETS.fetch(request);
      }
    }

    return unauthorized();
  }
};
