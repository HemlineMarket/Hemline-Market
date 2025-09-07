// api/send-test-email.js
export default async function handler(req, res) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    res.status(500).json({ error: "Missing POSTMARK_SERVER_TOKEN env var" });
    return;
  }

  const method = req.method || "GET";
  const q = method === "GET" ? req.query : (req.body || {});
  const to = (q.to || "hello@hemlinemarket.com").trim(); // change if you want
  const subject = (q.subject || "Hemline Market test email").trim();
  const text = (q.text || "This is a test email from Hemline Market.").trim();

  // Must be a verified Postmark sender/signature
  const from = "Hemline <hello@hemlinemarket.com>";

  try {
    const pmRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: "outbound",
      }),
    });

    const data = await pmRes.json();

    if (!pmRes.ok) {
      res.status(pmRes.status).json({ error: "Postmark error", details: data });
      return;
    }

    res.status(200).json({ ok: true, to, messageId: data.MessageID });
  } catch (err) {
    res.status(500).json({ error: "Request failed", details: String(err) });
  }
}
