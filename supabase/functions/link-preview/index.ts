// supabase/functions/link-preview/index.ts

// Edge runtime typings
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[link-preview] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set"
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- Types ----
type PreviewMeta = {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
};

// ---- Main handler ----
Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(
      { error: "Method not allowed, use POST" },
      405,
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_err) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const rawUrl = (body?.url || "").trim();
  if (!rawUrl) {
    return json({ error: "Missing url field" }, 400);
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return json({ error: "URL must be http or https" }, 400);
    }
  } catch (_err) {
    return json({ error: "Invalid URL" }, 400);
  }

  let html: string;
  try {
    const res = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent":
          "HemlineMarket-LinkPreview/1.0 (+https://hemlinemarket.com)",
      },
    });

    if (!res.ok) {
      return json(
        { error: "Could not fetch URL", status: res.status },
        502,
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return json(
        { error: "URL does not return HTML content" },
        415,
      );
    }

    html = await res.text();
  } catch (err) {
    console.error("[link-preview] fetch error", err);
    return json({ error: "Failed to fetch URL" }, 502);
  }

  const meta = extractMeta(html, target);
  const payload: PreviewMeta = {
    url: target.toString(),
    domain: target.hostname,
    title: meta.title || null,
    description: meta.description || null,
    image_url: meta.image_url || null,
  };

  // Upsert into link_previews (unique on url)
  let dbRow: any = null;
  try {
    const { data, error } = await supabase
      .from("link_previews")
      .upsert(
        {
          url: payload.url,
          domain: payload.domain,
          title: payload.title,
          description: payload.description,
          image_url: payload.image_url,
          last_fetched_at: new Date().toISOString(),
        },
        { onConflict: "url" },
      )
      .select()
      .single();

    if (error) {
      console.error("[link-preview] upsert error", error);
    } else {
      dbRow = data;
    }
  } catch (err) {
    console.error("[link-preview] upsert exception", err);
  }

  // Return either stored row or computed payload
  return json(
    {
      preview: dbRow || payload,
    },
    200,
  );
});

// ---- Helpers ----

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

type RawMeta = {
  title?: string;
  description?: string;
  image_url?: string;
};

function extractMeta(html: string, base: URL): RawMeta {
  const meta: RawMeta = {};

  // Prefer Open Graph tags
  const ogTitle = matchMetaTag(
    html,
    /<meta[^>]+property=["']og:title["'][^>]*>/i,
  );
  const ogDesc = matchMetaTag(
    html,
    /<meta[^>]+property=["']og:description["'][^>]*>/i,
  );
  const ogImage = matchMetaTag(
    html,
    /<meta[^>]+property=["']og:image["'][^>]*>/i,
  );

  const stdDesc = matchMetaTag(
    html,
    /<meta[^>]+name=["']description["'][^>]*>/i,
  );

  const titleTag = matchTitle(html);

  meta.title = ogTitle || titleTag || null;
  meta.description = ogDesc || stdDesc || null;

  if (ogImage) {
    meta.image_url = absolutize(ogImage, base);
  } else {
    const favicon = matchFavicon(html);
    meta.image_url = favicon ? absolutize(favicon, base) : null;
  }

  return meta;
}

function matchMetaTag(html: string, tagRe: RegExp): string | null {
  const tagMatch = html.match(tagRe);
  if (!tagMatch) return null;
  const tag = tagMatch[0];

  const contentRe = /content=["']([^"']*)["']/i;
  const contentMatch = tag.match(contentRe);
  if (!contentMatch) return null;

  return decodeHtml(contentMatch[1].trim());
}

function matchTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  return decodeHtml(match[1].trim());
}

function matchFavicon(html: string): string | null {
  // Try common rel values
  const rels = ["shortcut icon", "icon", "apple-touch-icon"];
  for (const rel of rels) {
    const re = new RegExp(
      `<link[^>]+rel=["']${rel}["'][^>]*>`,
      "i",
    );
    const tagMatch = html.match(re);
    if (!tagMatch) continue;

    const tag = tagMatch[0];
    const hrefRe = /href=["']([^"']*)["']/i;
    const hrefMatch = tag.match(hrefRe);
    if (!hrefMatch) continue;

    return decodeHtml(hrefMatch[1].trim());
  }
  return null;
}

function absolutize(urlLike: string | null | undefined, base: URL): string {
  try {
    if (!urlLike) return "";
    const u = new URL(urlLike, base);
    return u.toString();
  } catch (_err) {
    return "";
  }
}

function decodeHtml(str: string): string {
  // Very small HTML entity decode for common entities
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
