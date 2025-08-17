export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Hemline Market</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif; margin:24px">
  <h1>Hemline Market</h1>
  <p>If you see this page, routing works. Your static index.html is still in the repo; we’re serving this minimal page to fix the 404.</p>
  <p><a href="/index.html">Go to index.html</a></p>
</body>
</html>`);
}
