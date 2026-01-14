// File: /api/saved-searches/unsubscribe.js
// One-click unsubscribe from saved search alerts
// GET ?id=<search_id> - Disables email alerts and shows confirmation page
// No auth required (link from email)

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).send(renderPage("Missing search ID", false));
  }

  const supabase = getSupabaseAdmin();

  try {
    // Get the search to show its name
    const { data: search, error: fetchError } = await supabase
      .from("saved_searches")
      .select("id, name")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !search) {
      return res.status(404).send(renderPage("Saved search not found", false));
    }

    // Disable email alerts
    const { error: updateError } = await supabase
      .from("saved_searches")
      .update({ email_alerts: false })
      .eq("id", id);

    if (updateError) {
      console.error("[saved-searches/unsubscribe] Error:", updateError);
      return res.status(500).send(renderPage("Failed to unsubscribe", false));
    }

    return res.status(200).send(renderPage(search.name, true));

  } catch (e) {
    console.error("[saved-searches/unsubscribe] Error:", e);
    return res.status(500).send(renderPage("An error occurred", false));
  }
}

function renderPage(searchName, success) {
  const title = success ? "Unsubscribed" : "Error";
  const message = success 
    ? `You've been unsubscribed from alerts for "${searchName}".`
    : searchName;
  const icon = success ? "✅" : "❌";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Hemline Market</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f4f4f7;
      margin: 0;
      padding: 40px 20px;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { margin: 0 0 12px; font-size: 24px; color: #111827; }
    p { margin: 0 0 20px; color: #6b7280; font-size: 15px; line-height: 1.5; }
    a {
      display: inline-block;
      background: #991b1b;
      color: #fff;
      padding: 12px 24px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    a:hover { background: #7f1d1d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${success ? '<p style="color:#6b7280;font-size:13px;">You can re-enable alerts anytime from your Favorites page.</p>' : ''}
    <a href="https://hemlinemarket.com/favorites.html">Go to Favorites</a>
  </div>
</body>
</html>
  `;
}
