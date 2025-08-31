// api/contact.js
// Serverless function on Vercel to forward contact form messages to hello@hemlinemarket.com
// Uses Resend's HTTP API. Also supports GET /api/contact?diag=1 to verify env is loaded.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Basic email check (good enough for form validation)
function looksLikeEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// CORS helper
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Safe diagnostic without creating another function:
  if (req.method === "GET") {
    const key = process.env.RESEND_API_KEY || "";
    return res.status(200).json({
      ok: true,
      vercelEnv: process.env.VERCEL_ENV || null, // expect "production"
      hasKey: key.length > 0,
      keyStartsWith: key.slice(0, 3), // expect "re_"
      keyLength: key.length          // should be > 20
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Expecting JSON from the frontend
    const { name, email, message, honeypot } = req.body || {};

    // Simple spam trap (hidden field on the form)
    if (honeypot && String(honeypot).trim() !== "") {
      return res.status(200).json({ ok: true, skipped: true });
    }

    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: "Missing required fields." });
    }

    if (!looksLikeEmail(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }

    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
        <h2 style="margin:0 0 12px">New Contact Message</h2>
        <p><strong>From:</strong> ${String(name).trim()} &lt;${String(email).trim()}&gt;</p>
        <p><strong>Message:</strong></p>
        <div style="white-space: pre-wrap; border:1px solid #eee; padding:12px; border-radius:8px;">
          ${String(message).replace(/[<>]/g, c => ({'<':'&lt;','>':'&gt;'}[c]))}
        </div>
      </div>
    `;

    const text = `New Contact Message

From: ${String(name).trim()} <${String(email).trim()}>
----------------------------------------
${String(message)}
`;

    // Send the email through Resend
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY || ""}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Hemline Market Contact <onboarding@resend.dev>",
        to: ["hello@hemlinemarket.com"],
        reply_to: [String(email).trim()],
        subject: `Hemline Market Contact: ${String(name).trim()}`,
        html,
        text
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(500).json({ ok: false, error: "Email send failed", detail: data });
    }

    return res.status(200).json({ ok: true, id: data.id || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Server error", detail: String(err) });
  }
};
