// supabase/functions/fetch-link-metadata/index.ts

// Optional typings for Supabase Edge runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type MetadataResponse =
  | {
      type: "youtube";
      url: string;
      title: string | null;
      authorName: string | null;
      thumbnailUrl: string | null;
      html: string | null;
      providerName: string | null;
    }
  | {
      type: "link";
      url: string;
      title: string | null;
      description: string | null;
      image: string | null;
      siteName: string | null;
      domain: string | null;
    };

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return jsonError("Missing or invalid 'url' in body", 400);
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return jsonError("Invalid URL format", 400);
    }

    const hostname = parsed.hostname.toLowerCase();

    // --- Special handling for YouTube (oEmbed) ---
    if (
      hostname.includes("youtube.com") ||
      hostname.includes("youtu.be")
    ) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        url
      )}&format=json`;

      const oembedRes = await fetch(oembedUrl);

      if (!oembedRes.ok) {
        return jsonError(
          `Failed to fetch YouTube oEmbed: ${oembedRes.status}`,
          502
        );
      }

      const oembed = await oembedRes.json();

      const payload: MetadataResponse = {
        type: "youtube",
        url,
        title: (oembed as any).title ?? null,
        authorName: (oembed as any).author_name ?? null,
        thumbnailUrl: (oembed as any).thumbnail_url ?? null,
        html: (oembed as any).html ?? null,
        providerName: (oembed as any).provider_name ?? "YouTube",
      };

      return jsonOk(payload);
    }

    // --- Generic OpenGraph/HTML metadata fetch ---
    const pageRes = await fetch(url, {
      redirect: "follow",
    });

    if (!pageRes.ok) {
      return jsonError(
        `Failed to fetch URL: ${pageRes.status}`,
        502
      );
    }

    // Limit size in case of very large pages
    const text = await pageRes.text();
    const html = text.slice(0, 200_000); // 200 KB cap for parsing

    const title =
      getMetaContent(html, 'property="og:title"') ??
      getMetaContent(html, "name=\"twitter:title\"") ??
      getTitleTag(html);

    const description =
      getMetaContent(html, 'property="og:description"') ??
      getMetaContent(html, "name=\"description\"") ??
      null;

    const image =
      getMetaContent(html, 'property="og:image"') ??
      getMetaContent(html, "name=\"twitter:image\"") ??
      null;

    const siteName =
      getMetaContent(html, 'property="og:site_name"') ?? null;

    const payload: MetadataResponse = {
      type: "link",
      url,
      title,
      description,
      image,
      siteName,
      domain: hostname,
    };

    return jsonOk(payload);
  } catch (err) {
    console.error("[fetch-link-metadata] Error:", err);
    return jsonError("Unexpected error while fetching metadata", 500);
  }
});

function jsonOk(data: MetadataResponse): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  const raw = match[1].trim();
  return raw || null;
}

function getMetaContent(
  html: string,
  attrPattern: string
): string | null {
  // Very simple meta tag matcher:
  // looks for: <meta ... attrPattern ... content="...">
  const regex = new RegExp(
    `<meta[^>]*${attrPattern}[^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(regex);
  if (!match) return null;
  const value = match[1].trim();
  return value || null;
}
