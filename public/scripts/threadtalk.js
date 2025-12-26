// ThreadTalk Updates - Apply these changes to scripts/threadtalk.js
// 
// CHANGES:
// 1. YouTube videos embed inline (playable in ThreadTalk)
// 2. Hide raw URL when link preview is shown (cleaner)
// 3. More Facebook-like styling

// ============================================================
// CHANGE 1: Update linkify() function to hide URLs that will get previews
// Find the existing linkify function (around line 1687) and replace with:
// ============================================================

function linkify(text, hidePreviewUrls = false) {
  const str = String(text || "");
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let html = "";
  let match;
  let firstUrl = true;

  while ((match = urlRegex.exec(str)) !== null) {
    const url = match[0];
    const before = str.slice(lastIndex, match.index);
    html += escapeHtml(before);
    
    // If hidePreviewUrls is true, skip the FIRST URL (it will be shown as a preview)
    if (hidePreviewUrls && firstUrl) {
      firstUrl = false;
      // Don't add the URL to html - it will be shown as a preview card
    } else {
      html += `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    }
    lastIndex = match.index + url.length;
  }

  html += escapeHtml(str.slice(lastIndex));
  return html.trim();
}

// ============================================================
// CHANGE 2: Update the card innerHTML (around line 470) to use hidePreviewUrls
// Change this line:
//   <div class="preview">${linkify(thread.body || "")}</div>
// To:
// ============================================================

// In the card.innerHTML template, change the preview line to:
`<div class="preview">${linkify(thread.body || "", hasUrlInBody(thread.body))}</div>`

// Add this helper function near linkify:
function hasUrlInBody(text) {
  return /https?:\/\/[^\s]+/.test(text || "");
}

// ============================================================
// CHANGE 3: Update attachLinkPreview() to embed YouTube videos
// Replace the entire attachLinkPreview function (around line 1733-1808):
// ============================================================

async function attachLinkPreview(card, thread) {
  const body = thread.body || "";
  const urlMatch = body.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return;

  const url = urlMatch[0];
  
  // Check if it's a YouTube video - embed it!
  if (isYoutubeUrl(url)) {
    const videoId = extractYoutubeId(url);
    if (videoId) {
      const actionsRow = card.querySelector(".tt-actions-row");
      if (!actionsRow) return;

      const container = document.createElement("div");
      container.className = "tt-youtube-embed";
      container.innerHTML = `
        <iframe 
          src="https://www.youtube.com/embed/${videoId}" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
      card.insertBefore(container, actionsRow);
      return;
    }
  }

  // For non-YouTube links, show a card preview
  let previewData = null;
  try {
    previewData = await fetchLinkMetadata(url);
  } catch (_) {
    previewData = null;
  }

  const rawTitle = (previewData && (previewData.title || previewData.ogTitle)) || "";
  let title = rawTitle || url;
  if (title.length > 100) title = title.slice(0, 97) + "…";

  let host = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
  } catch (_) {
    host = "";
  }

  let thumb = (previewData && (previewData.thumbnailUrl || previewData.thumbnail_url || previewData.image || previewData["og:image"])) || null;

  const actionsRow = card.querySelector(".tt-actions-row");
  if (!actionsRow) return;

  const container = document.createElement("div");
  container.className = "tt-link-preview-wrap";

  container.innerHTML = `
    <a class="tt-link-card" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
      ${thumb ? `<div class="tt-link-thumb" style="background-image:url('${escapeAttr(thumb)}');"></div>` : ""}
      <div class="tt-link-meta">
        <div class="tt-link-title">${escapeHtml(title)}</div>
        ${host ? `<div class="tt-link-host">${escapeHtml(host)}</div>` : ""}
      </div>
    </a>
  `;

  card.insertBefore(container, actionsRow);
}

// ============================================================
// CHANGE 4: Add YouTube embed styles to injectCompactStyles()
// Add these CSS rules inside the injectCompactStyles function:
// ============================================================

/* YouTube embed container */
.tt-youtube-embed{
  margin: 8px 0;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
  position: relative;
  padding-bottom: 56.25%; /* 16:9 aspect ratio */
  height: 0;
}
.tt-youtube-embed iframe{
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}

/* Cleaner link preview */
.tt-link-preview-wrap{
  margin: 8px 0;
  max-width: 100%;
}
.tt-link-card{
  display: flex;
  text-decoration: none;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  overflow: hidden;
  transition: background 0.15s;
}
.tt-link-card:hover{
  background: #f3f4f6;
}
.tt-link-thumb{
  flex: 0 0 120px;
  min-height: 80px;
  background-size: cover;
  background-position: center;
}
.tt-link-meta{
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}
.tt-link-title{
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.tt-link-host{
  font-size: 12px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* Facebook-style card improvements */
.card{
  padding: 12px 16px;
  margin-bottom: 12px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #dddfe2;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

/* Author styling - more FB-like */
.tt-head{
  margin-bottom: 8px;
}
.tt-line2{
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tt-line2-main{
  display: flex;
  align-items: center;
  gap: 6px;
  color: #65676b;
  font-size: 13px;
}
.tt-author-link{
  font-weight: 600;
  color: #050505;
  text-decoration: none;
}
.tt-author-link:hover{
  text-decoration: underline;
}

/* Category pill - smaller, cleaner */
.cat{
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--hm-accent);
  text-decoration: none;
  padding: 2px 8px;
  background: #fef2f2;
  border-radius: 4px;
}
.cat:hover{
  background: #fee2e2;
}

/* Post title */
.tt-title{
  font-weight: 600;
  color: #1c1e21;
  font-size: 15px;
}

/* Body text */
.preview{
  font-size: 15px;
  line-height: 1.5;
  color: #050505;
  margin-bottom: 8px;
  word-wrap: break-word;
}
.preview:empty{
  display: none;
}
.preview a{
  color: #216fdb;
}

/* Actions row - FB style */
.tt-actions-row{
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid #e4e6eb;
  margin-top: 8px;
}

.tt-like-btn, .tt-reply-link{
  flex: 1;
  background: none;
  border: none;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 600;
  color: #65676b;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}
.tt-like-btn:hover, .tt-reply-link:hover{
  background: #f0f2f5;
}
.tt-like-btn.tt-like-active{
  color: #1877f2;
}

/* Reaction chips - FB style */
.tt-react-summary{
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  padding: 4px 0;
}
.tt-react-chip{
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: #65676b;
}
.tt-react-emoji{
  font-size: 16px;
}

/* Comments section */
.tt-comments{
  margin-top: 8px;
}
.tt-comment{
  background: #f0f2f5;
  border-radius: 18px;
  padding: 8px 12px;
  margin-bottom: 4px;
  border: none;
}
.tt-comment-head{
  font-size: 13px;
  color: #65676b;
  margin-bottom: 2px;
}
.tt-comment-author{
  font-weight: 600;
  color: #050505;
}
.tt-comment-body{
  font-size: 15px;
  color: #050505;
  line-height: 1.4;
}

/* Comment input - FB style */
.tt-comment-new{
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.tt-comment-input{
  flex: 1;
  background: #f0f2f5;
  border: none;
  border-radius: 20px;
  padding: 8px 12px;
  font-size: 14px;
}
.tt-comment-input:focus{
  outline: none;
  background: #e4e6eb;
}
.tt-comment-send{
  background: #1877f2;
  color: white;
  border: none;
  border-radius: 20px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
}
.tt-comment-send:hover{
  background: #166fe5;
}

/* Share button */
.tt-share-chip{
  font-size: 12px;
  padding: 4px 10px;
  background: #e4e6eb;
  border: none;
  border-radius: 4px;
  color: #65676b;
  cursor: pointer;
}
.tt-share-chip:hover{
  background: #d8dadf;
}

/* Mobile adjustments */
@media (max-width: 640px){
  .tt-youtube-embed{
    margin: 6px -16px;
    border-radius: 0;
  }
  .tt-link-thumb{
    flex: 0 0 80px;
    min-height: 60px;
  }
  .tt-link-title{
    font-size: 13px;
  }
}
