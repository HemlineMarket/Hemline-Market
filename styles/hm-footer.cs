/* Hemline Market — Shared Footer Styles
   Usage:
   1) Add: <link rel="stylesheet" href="styles/hm-footer.css" />
   2) Remove per-page inline footer CSS duplicates.
*/

:root{
  --hm-border:#e5e7eb;
  --hm-soft:#f7f7f8;
  --hm-text:#1f2937;
  --hm-muted:#6b7280;
}

/* Base footer */
footer.hm-footer{
  border-top:1px solid var(--hm-border);
  padding:16px 0;
  margin-top:24px;
  background:var(--hm-soft);
}

/* Inner wrapper */
.hm-footer .footer-wrap{
  max-width:1200px;
  margin:0 auto;
  padding:0 16px;
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  align-items:center;
  justify-content:space-between;
}

/* Link row */
.hm-footer .footer-links{
  display:flex;
  gap:14px;
  flex-wrap:wrap;
}

.hm-footer .footer-links a{
  font-size:14px;
  color:var(--hm-text);
  text-decoration:none;
}

.hm-footer .footer-links a:hover{
  text-decoration:underline;
}

/* Current page hint (optional; add aria-current="page" on the link) */
.hm-footer .footer-links a[aria-current="page"]{
  font-weight:700;
  text-decoration:underline;
}

/* Copyright */
.hm-footer .copy{
  font-size:13px;
  color:var(--hm-muted);
}

/* Compact mode helper (optional)
   Add class "hm-footer--compact" on <footer> if a page needs a tighter footer.
*/
footer.hm-footer.hm-footer--compact{
  padding:12px 0;
}

/* Stack layout helper for very narrow screens (optional) */
@media (max-width:480px){
  .hm-footer .footer-wrap{
    flex-direction:column;
    align-items:flex-start;
    gap:8px;
  }
}
