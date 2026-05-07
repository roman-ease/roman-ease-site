export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing code', { status: 400 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id:     (env.GITHUB_CLIENT_ID || 'Ov23li5zG6wWefYBBKoU').trim(),
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await tokenRes.json();

  if (!data.access_token) {
    return new Response(`認証エラー: ${data.error_description || data.error}`, { status: 400 });
  }

  const token    = JSON.stringify(data.access_token);
  const provider = 'github';
  const message  = `authorization:${provider}:success:${JSON.stringify({ token: data.access_token, provider })}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>
<script>
(function () {
  const msg = ${JSON.stringify(message)};
  function onMessage(e) {
    window.opener.postMessage(msg, e.origin);
    window.close();
  }
  window.addEventListener('message', onMessage, false);
  window.opener.postMessage('authorizing:${provider}', '*');
})();
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
