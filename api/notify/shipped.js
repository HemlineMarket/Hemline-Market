// File: api/notify/shipped.js
// Sends shipping notification email to buyer when seller marks order as shipped
// Called from order-seller.html when seller clicks "Mark as Shipped"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const POSTMARK = process.env.POSTMARK_SERVER_TOKEN;
  const FROM = process.env.FROM_EMAIL || "orders@hemlinemarket.com";

  if (!POSTMARK) {
    console.log("[notify/shipped] No POSTMARK_SERVER_TOKEN, skipping email");
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const { 
      order_id, 
      buyer_email, 
      listing_title, 
      tracking_number, 
      tracking_url 
    } = req.body || {};

    if (!buyer_email) {
      return res.status(400).json({ error: "Missing buyer_email" });
    }

    const safeTitle = (listing_title || "Your order").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeTracking = (tracking_number || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const trackingHtml = tracking_number 
      ? `<p style="margin:0 0 16px;"><strong>Tracking Number:</strong> ${safeTracking}</p>
         ${tracking_url ? `<p><a href="${tracking_url}" style="background:#991b1b;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Track Package</a></p>` : ''}`
      : `<p style="margin:0 0 16px;color:#6b7280;">No tracking number provided yet. The seller may update this soon.</p>`;

    const htmlBody = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;">
        <h1 style="color:#991b1b;">📦 Your Order Has Shipped!</h1>
        <p style="margin:0 0 16px;font-size:16px;">Great news! <strong>"${safeTitle}"</strong> is on its way to you.</p>
        
        <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px;margin:20px 0;">
          <h3 style="margin:0 0 12px;color:#1e40af;">Shipping Details</h3>
          ${trackingHtml}
        </div>
        
        <p style="margin:16px 0;">You'll receive another notification when your package is delivered.</p>
        
        <p><a href="https://hemlinemarket.com/purchases.html" style="color:#991b1b;font-weight:600;">View Your Orders</a></p>
        
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#6b7280;font-size:14px;">Happy sewing!<br><strong>Hemline Market</strong></p>
      </div>
    `;

    const textBody = `Your order has shipped!

"${listing_title || 'Your order'}" is on its way to you.

${tracking_number ? `Tracking Number: ${tracking_number}` : 'No tracking number provided yet.'}
${tracking_url ? `Track your package: ${tracking_url}` : ''}

View your orders at: https://hemlinemarket.com/purchases.html

Happy sewing!
Hemline Market`;

    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "X-Postmark-Server-Token": POSTMARK 
      },
      body: JSON.stringify({ 
        From: FROM, 
        To: buyer_email, 
        Subject: `📦 Your order has shipped! - Hemline Market`, 
        HtmlBody: htmlBody, 
        TextBody: textBody, 
        MessageStream: "outbound" 
      }),
    });

    console.log("[notify/shipped] Email sent to:", buyer_email);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("[notify/shipped] Error:", err);
    return res.status(500).json({ error: "Failed to send email" });
  }
}
