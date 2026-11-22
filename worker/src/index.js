const SUB_FETCH_ENDPOINT = 'https://app9074617711.tgcloud.ai/api/subFetch';
const SUB_PATH_RE = /^\/sub\/([a-f0-9]{48})$/;

function plainText(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET') {
      return plainText('Method not allowed', 405);
    }

    const url = new URL(request.url);
    const match = SUB_PATH_RE.exec(url.pathname);
    if (!match) {
      return plainText('Not found', 404);
    }

    const token = match[1];
    const secret = env?.SUB_WORKER_SECRET || '';
    if (!secret) {
      return plainText('Service unavailable', 503);
    }

    let upstream;
    try {
      upstream = await fetch(SUB_FETCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sub-secret': secret,
        },
        body: JSON.stringify({ token }),
      });
    } catch {
      return plainText('Upstream unavailable', 502);
    }

    let data = null;
    try {
      data = await upstream.json();
    } catch {
      return plainText('Upstream error', 502);
    }

    const status = Number(data?.status || upstream.status || 500);
    if (status === 200 && typeof data?.body === 'string') {
      return plainText(data.body, 200);
    }

    if (status === 401) return plainText('Unauthorized', 401);
    if (status === 404) return plainText('Not found', 404);
    if (status === 429) return plainText('Slow down', 429);
    if (status === 503) return plainText('No configs available', 503);
    return plainText('Subscription unavailable', status >= 400 ? status : 500);
  },
};
