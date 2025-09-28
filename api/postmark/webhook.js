// File: /api/postmark/webhook.js
// Accepts Postmark webhooks and updates public.email_log.
// Security: requires ?token=... that matches POSTMARK_WEBHOOK_TOKEN (set in Vercel).

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

// read raw body for Postmark
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function statusFromRecordType(rt, evt) {
  const t = String(rt || "").toLowerCase();
  if (t === "delivery") return "delivered";
  if (t === "bounce") {
    const kind = evt?.Type || evt?.BounceType || "bounced";
    return String(kind).toLowerCase();
  }
  if (t === "spamcomplaint") return "complaint";
  if (t === "open") return "opened";
  if (t === "click") return "clicked";
  return t || "event";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // --- token check ---
    const urlToken = (req.query?.token || "").toString();
    const envToken = process.env.POSTMARK_WEBHOOK_TOKEN || "";
    if (!envToken || urlToken !== envToken) {
      // Tip: set POSTMARK_WEBHOOK_TOKEN in Vercel env to: Icreatedthismyself
      return res.status(401).json({ error: "Unauthorized" });
    }

    // --- parse body ---
    const raw = await buffer(req);
    let evt;
    try {
      evt = JSON.parse(raw.toString("utf-8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const recordType = evt.RecordType;            // Delivery | Bounce | SpamComplaint | Open | Click
    const messageId =
      evt.MessageID || evt.MessageId || evt.MessageIDString || null;
    const recipient = evt.Recipient || evt.Email || evt.To || null;

    const status = statusFromRecordType(recordType, evt);
    const error =
      recordType === "Bounce"
        ? { type: evt.Type || evt.BounceType, description: evt.Description }
        : null;

    // Try to update existing log row by provider_id (Postmark MessageID)
    if (messageId) {
      const { data: updated, error: updErr } = await supabase
        .from("email_log")
        .update({
          status,
          error: error ? JSON.stringify(error) : null,
        })
        .eq("provider_id", messageId)
        .select("id")
        .limit(1);

      if (!updErr && updated && updated.length) {
        return res.status(200).json({ ok: true, updated: updated[0].id, status });
      }
    }

    // If we didn't find an existing row, insert a new one
    const { error: insErr } = await supabase.from("email_log").insert({
      to_email: recipient || null,
      subject: null,
      status,
      provider_id: messageId || null,
      template: "postmark_event",
      payload: evt ? JSON.stringify(evt) : null,
      error: error ? JSON.stringify(error) : null,
    });

    if (insErr) {
      console.error("[postmark/webhook] insert error:", insErr);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ ok: true, inserted: true, status });
  } catch (err) {
    console.error("[postmark/webhook] error:", err?.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
