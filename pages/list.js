// pages/list.js
import Head from "next/head";
import { useEffect } from "react";

export default function ListPage() {
  useEffect(() => {
    // ===== Helpers =====
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    const form = document.getElementById("sell-form");
    if (!form) return;

    const errorBanner = document.getElementById("error-banner");
    const okBanner = document.getElementById("ok-banner");
    const publishBtn = document.getElementById("publish-btn");

    // ----- Yards picker (0.5 increments) -----
    const yardsSelect = document.getElementById("yardsSelect");
    const yardsHidden = document.getElementById("yards");
    if (yardsSelect && yardsSelect.children.length === 0) {
      const max = 100;
      const frag = document.createDocumentFragment();
      for (let v = 0.5; v <= max; v += 0.5) {
        const opt = document.createElement("option");
        opt.value = v.toFixed(1);
        opt.textContent = v.toFixed(1);
        frag.appendChild(opt);
      }
      yardsSelect.appendChild(frag);
      yardsSelect.value = "0.5";
      yardsHidden.value = "0.5";
      yardsSelect.addEventListener("change", () => (yardsHidden.value = yardsSelect.value));
    }

    // ----- Unknown toggles for width/weight -----
    $("#widthUnknown")?.addEventListener("change", (e) => {
      const i = $("#widthIn");
      i.disabled = e.target.checked;
      if (e.target.checked) i.value = "";
    });
    $("#weightUnknown")?.addEventListener("change", (e) => {
      const i = $("#weightGsm");
      i.disabled = e.target.checked;
      if (e.target.checked) i.value = "";
    });

    // ----- Unknown option for content/type disables others -----
    function wireUnknownCheckbox(unknownId, listSelector) {
      const unk = document.getElementById(unknownId);
      if (!unk) return;
      unk.addEventListener("change", () => {
        const others = $$(`${listSelector} input[type="checkbox"]`).filter((x) => x.id !== unknownId);
        others.forEach((x) => {
          x.disabled = unk.checked;
          if (unk.checked) x.checked = false;
        });
      });
    }
    wireUnknownCheckbox("contentUnknown", "#content-list");
    wireUnknownCheckbox("typeUnknown", "#type-list");

    // ----- Images uploader (drag/drop + reorder + remove) -----
    const uploader = document.getElementById("uploader");
    const fileInput = document.getElementById("files");
    const pickBtn = document.getElementById("pickFiles");
    const thumbs = document.getElementById("thumbs");
    let images = []; // {id, url, file}

    function renderThumbs() {
      thumbs.innerHTML = "";
      images.forEach((img, idx) => {
        const t = document.createElement("div");
        t.className = "t";
        t.draggable = true;
        t.dataset.index = idx;

        const im = document.createElement("img");
        im.src = img.url;
        im.alt = `Image ${idx + 1}`;

        const handle = document.createElement("div");
        handle.className = "handle";
        handle.textContent = "Drag";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove";
        remove.innerHTML = "×";
        remove.addEventListener("click", () => {
          images.splice(idx, 1);
          renderThumbs();
          updatePreview();
        });

        t.appendChild(im);
        t.appendChild(handle);
        t.appendChild(remove);
        thumbs.appendChild(t);
      });
    }

    function addFiles(fileList) {
      const arr = Array.from(fileList || []).slice(0, 12); // soft cap
      arr.forEach((f) => {
        const url = URL.createObjectURL(f);
        images.push({ id: crypto.randomUUID(), file: f, url });
      });
      renderThumbs();
      updatePreview();
    }

    pickBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", (e) => addFiles(e.target.files));

    function prevent(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (uploader) {
      ["dragenter", "dragover"].forEach((ev) =>
        uploader.addEventListener(ev, (e) => {
          prevent(e);
          uploader.classList.add("drag");
        })
      );
      ["dragleave", "drop"].forEach((ev) =>
        uploader.addEventListener(ev, (e) => {
          prevent(e);
          uploader.classList.remove("drag");
        })
      );
      uploader.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    }

    // Reorder via drag & drop on grid
    let dragIndex = null;
    thumbs?.addEventListener("dragstart", (e) => {
      const t = e.target.closest(".t");
      if (!t) return;
      dragIndex = Number(t.dataset.index);
      t.classList.add("dragging");
    });
    thumbs?.addEventListener("dragend", (e) => {
      e.target.closest(".t")?.classList.remove("dragging");
      dragIndex = null;
    });
    thumbs?.addEventListener("dragover", (e) => {
      e.preventDefault();
      const over = e.target.closest(".t");
      if (!over || dragIndex === null) return;
      const overIndex = Number(over.dataset.index);
      if (overIndex === dragIndex) return;
      // swap positions
      const [moved] = images.splice(dragIndex, 1);
      images.splice(overIndex, 0, moved);
      dragIndex = overIndex;
      renderThumbs();
    });

    // ----- Values, preview & validation -----
    function getValues() {
      const v = Object.fromEntries(new FormData(form).entries());
      v.pricePerYd = Number(v.pricePerYd || 0);
      v.yards = Number(v.yards || 0);
      v.widthIn = Number(v.widthIn || 0);
      v.weightGsm = Number(v.weightGsm || 0);
      v.department = $$('input[name="department"]:checked', form).map((i) => i.value);
      v.country = $$('input[name="country"]:checked', form).map((i) => i.value);
      v.content = $$('input[name="content"]:checked', form).map((i) => i.value);
      v.type = $$('input[name="type"]:checked', form).map((i) => i.value);
      v.colors = $$('input[name="color"]:checked', form).map((i) => i.value);
      v.sellingMode = $('input[name="sellingMode"]:checked', form)?.value || "lot";
      v.contentOther = $("#contentOther")?.value?.trim() || "";
      v.typeOther = $("#typeOther")?.value?.trim() || "";
      v.images = images.map((m) => m.url);
      return v;
    }

    function thumbClassFrom(v) {
      if (v.images?.length) return ""; // real image
      if (v.type.includes("crepe")) return "thumb--crepe";
      if (v.type.includes("sateen")) return "thumb--sateen";
      if (v.content.includes("silk")) return "thumb--silk";
      if (v.content.includes("wool")) return "thumb--wool";
      return "thumb--cotton";
    }

    function updatePreview() {
      const v = getValues();
      document.getElementById("p-title").textContent = v.title || "Your Title";
      document.getElementById("p-meta").textContent = `${v.yards || 0} yd • ${v.widthIn || 0}″ • ${(v.country[0] || "—").toUpperCase()}`;
      document.getElementById("p-price").textContent = `$${v.pricePerYd || 0} / yd`;
      document.getElementById("p-tags").textContent = [v.type.join(", "), v.content.join(", "), v.sellingMode === "increments" ? "0.5 yd increments" : "sold as one lot"]
        .filter(Boolean)
        .join(" • ");
      document.getElementById("p-desc").textContent = v.description || "";
      const th = document.getElementById("preview-thumb");
      if (v.images?.length) {
        th.style.background = `url('${v.images[0]}') center/cover no-repeat`;
        th.className = "thumb";
      } else {
        th.removeAttribute("style");
        th.className = "thumb " + thumbClassFrom(v);
      }
    }

    function setFieldError(key, hasError) {
      const field = form.querySelector(`[data-field="${key}"]`);
      if (!field) return;
      field.classList.toggle("error", !!hasError);
    }

    function validate() {
      const v = getValues();
      const errs = [];

      if (!v.title || !v.title.trim()) {
        errs.push("Title is required.");
        setFieldError("title", true);
      } else setFieldError("title", false);

      if (isNaN(v.pricePerYd) || v.pricePerYd < 0) {
        errs.push("Price per yard must be ≥ 0.");
        setFieldError("pricePerYd", true);
      } else setFieldError("pricePerYd", false);

      if (isNaN(v.yards) || v.yards < 0.5) {
        errs.push("Yards available must be ≥ 0.5.");
        setFieldError("yards", true);
      } else setFieldError("yards", false);

      const deptOk = v.department.length > 0;
      if (!deptOk) {
        errs.push("Select at least one department or mark Unknown.");
        setFieldError("department", true);
      } else setFieldError("department", false);

      // Content/type can be unknown or other, or checked items
      const contentOk = v.content.includes("unknown") || v.content.length > 0 || !!v.contentOther;
      if (!contentOk) {
        errs.push("Select a fabric content (or Unknown/Other).");
        setFieldError("content", true);
      } else setFieldError("content", false);

      const typeOk = v.type.includes("unknown") || v.type.length > 0 || !!v.typeOther;
      if (!typeOk) {
        errs.push("Select a fabric type (or Unknown/Other).");
        setFieldError("type", true);
      } else setFieldError("type", false);

      if (errs.length) {
        okBanner.classList.remove("show");
        okBanner.textContent = "";
        errorBanner.classList.add("show");
        errorBanner.innerHTML =
          'Please fix the following:<ul style="margin:6px 0 0 18px">' +
          errs.map((e) => `<li>${e}</li>`).join("") +
          "</ul>";
      } else {
        errorBanner.classList.remove("show");
        errorBanner.textContent = "";
        okBanner.classList.add("show");
        okBanner.textContent = "Looks good — ready to publish.";
      }
      publishBtn.disabled = errs.length > 0;
      return errs.length === 0;
    }

    form.addEventListener("input", () => {
      updatePreview();
      validate();
    });

    document.getElementById("preview-btn")?.addEventListener("click", () => {
      updatePreview();
      validate();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      updatePreview();
      if (!validate()) return;

      const v = getValues();
      const payload = {
        title: v.title.trim(),
        pricePerYd: v.pricePerYd,
        yards: v.yards,
        sellingMode: v.sellingMode,
        widthIn: v.widthIn || null,
        weightGsm: v.weightGsm || null,
        department: v.department,
        country: v.country,
        content: v.content.includes("unknown") && v.content.length === 1 ? ["unknown"] : [...v.content, ...(v.contentOther ? [v.contentOther] : [])],
        type: v.type.includes("unknown") && v.type.length === 1 ? ["unknown"] : [...v.type, ...(v.typeOther ? [v.typeOther] : [])],
        condition: v.condition || "new",
        pattern: v.pattern || "solid",
        description: v.description?.trim() || "",
        images: v.images
      };

      okBanner.classList.add("show");
      okBanner.textContent = "✅ Listing would be published (demo). Check console for payload.";
      console.log("SELLER_PAYLOAD", payload);
    });

    // Initial render
    renderThumbs();
    updatePreview();
    validate();
  }, []);

  return (
    <>
      <Head>
        <title>Hemline Market — List an Item</title>
        <meta name="theme-color" content="#333333" />
      </Head>

      <header className="hm-header" role="banner">
        <div className="hm-header-inner">
          <a className="hm-logo" href="/" aria-label="Hemline Market home">
            <img src="/logo.png" alt="Hemline Market logo" onError={(e) => (e.currentTarget.style.display = "none")} />
          </a>
          <nav className="hm-nav" aria-label="Primary">
            <a href="/new">New Arrivals</a>
            <a href="/atelier">My Atelier</a>
            <a href="/favorites">
              <svg className="hm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.8 4.6c-1.8-1.8-4.8-1.8-6.6 0L12 6.8l-2.2-2.2c-1.8-1.8-4.8-1.8-6.6 0-1.8 1.8-1.8 4.8 0 6.6l8.8 8.8 8.8-8.8c1.8-1.8 1.8-4.8 0-6.6z" />
              </svg>
              Favorites
            </a>
            <a href="/notifications">
              <svg className="hm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Notifications
            </a>
            <a href="/account">My Account</a>
            <a className="cta" href="/list">List Item</a>
          </nav>
          <div style={{ width: 36, height: 36 }} />
        </div>
      </header>

      <main className="container">
        {/* FORM */}
        <section className="card">
          <h2>List an Item</h2>
          <div id="error-banner" className="error-banner" role="alert"></div>
          <div id="ok-banner" className="ok-banner" role="status"></div>

          <form id="sell-form" className="card-body" noValidate>
            {/* 1) IMAGES FIRST */}
            <div className="field">
              <label className="label">Images (3+ recommended)</label>
              <div className="hint">
                Primary: full piece on a flat surface • Close-up: weave/texture • Drape on form • Back side • Any defects
              </div>
              <div id="uploader" className="uploader" tabIndex={0}>
                <input id="files" type="file" accept="image/*" multiple />
                <div>Drag &amp; drop images here or</div>
                <button type="button" className="btn" id="pickFiles">
                  Choose Images
                </button>
              </div>
              <div id="thumbs" className="thumbs" aria-live="polite"></div>
            </div>

            {/* 2) DESCRIPTION */}
            <div className="field">
              <label className="label" htmlFor="description">
                Description
              </label>
              <textarea id="description" name="description" className="input" placeholder="Mention drape, structure/hand, weave, care, defects, finish, stretch, end-use, etc."></textarea>
            </div>

            <div className="field" data-field="title">
              <label className="label" htmlFor="title">
                Title <span className="hint">(required)</span>
              </label>
              <input className="input" id="title" name="title" placeholder="e.g., Italian Silk Twill — Navy Chain" required />
              <div className="error-text">Please enter a title.</div>
            </div>

            <div className="row">
              <div className="field" data-field="pricePerYd">
                <label className="label" htmlFor="pricePerYd">
                  Price (per yard) <span className="hint">(required)</span>
                </label>
                <input className="input" type="number" id="pricePerYd" name="pricePerYd" min="0" step="0.01" placeholder="e.g., 48" required />
                <div className="error-text">Enter a price per yard (≥ 0).</div>
              </div>

              {/* YARDS PICKER */}
              <div className="field" data-field="yards">
                <label className="label" htmlFor="yardsSelect">
                  Yards Available <span className="hint">(0.5 increments, required)</span>
                </label>
                <select id="yardsSelect" className="select" required></select>
                <input type="hidden" id="yards" name="yards" defaultValue="" />
                <div className="error-text">Select yards available (≥ 0.5).</div>
              </div>
            </div>

            {/* Selling mode */}
            <div className="field">
              <label className="label">Selling Mode</label>
              <div className="checklist" style={{ gridTemplateColumns: "1fr" }}>
                <label className="check">
                  <input type="radio" name="sellingMode" value="lot" defaultChecked /> Sell all yardage together as one lot
                </label>
                <label className="check">
                  <input type="radio" name="sellingMode" value="increments" /> Sell in 0.5 yard increments (buyer chooses quantity)
                </label>
              </div>
            </div>

            <div className="row">
              <div className="field" data-field="widthIn">
                <label className="label" htmlFor="widthIn">
                  Width (inches)
                </label>
                <input className="input" type="number" id="widthIn" name="widthIn" min="1" step="0.1" placeholder="e.g., 54" />
                <div className="error-text">Width must be ≥ 1 inch.</div>
                <div className="hint">
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" id="widthUnknown" /> Unknown
                  </label>
                </div>
              </div>
              <div className="field" data-field="weightGsm">
                <label className="label" htmlFor="weightGsm">
                  Weight (GSM)
                </label>
                <input className="input" type="number" id="weightGsm" name="weightGsm" min="0" step="1" placeholder="e.g., 95" />
                <div className="error-text">Weight must be ≥ 0.</div>
                <div className="hint">
                  <label className="check" style={{ marginTop: 6 }}>
                    <input type="checkbox" id="weightUnknown" /> Unknown
                  </label>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="field" data-field="department">
                <label className="label">
                  Department <span className="hint">(select at least one or Unknown)</span>
                </label>
                <div className="checklist">
                  <label className="check">
                    <input type="checkbox" name="department" value="fashion" /> Fashion
                  </label>
                  <label className="check">
                    <input type="checkbox" name="department" value="home" /> Home
                  </label>
                  <label className="check">
                    <input type="checkbox" name="department" value="quilting" /> Quilting
                  </label>
                  <label className="check">
                    <input type="checkbox" name="department" value="notions" /> Notions
                  </label>
                  <label className="check">
                    <input type="checkbox" name="department" value="unknown" id="deptUnknown" /> Unknown
                  </label>
                </div>
                <div className="error-text">Choose at least one department or mark Unknown.</div>
              </div>
              <div className="field">
                <label className="label">Country Made</label>
                <div className="checklist">
                  <label className="check">
                    <input type="checkbox" name="country" value="france" /> France
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="italy" /> Italy
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="japan" /> Japan
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="uk" /> UK
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="usa" /> USA
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="other" /> Other
                  </label>
                  <label className="check">
                    <input type="checkbox" name="country" value="unknown" /> Unknown
                  </label>
                </div>
              </div>
            </div>

            {/* Fabric Content */}
            <div className="field" data-field="content">
              <label className="label">Fabric Content (multi-select)</label>
              <div className="checklist" id="content-list">
                <label className="check">
                  <input type="checkbox" name="content" value="unknown" id="contentUnknown" /> Unknown
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="acetate" /> Acetate
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="acrylic" /> Acrylic
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="alpaca" /> Alpaca
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="bamboo" /> Bamboo
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="cashmere" /> Cashmere
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="cotton" /> Cotton
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="cupro" /> Cupro
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="elastane" /> Elastane/Spandex
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="hemp" /> Hemp
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="leather" /> Leather
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="linen" /> Linen
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="modal" /> Modal
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="mohair" /> Mohair
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="nylon" /> Nylon
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="polyamide" /> Polyamide
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="polyester" /> Polyester
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="polyurethane" /> Polyurethane
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="rayon" /> Rayon/Viscose
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="silk" /> Silk
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="tencel" /> Tencel
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="triacetate" /> Triacetate
                </label>
                <label className="check">
                  <input type="checkbox" name="content" value="wool" /> Wool
                </label>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <div className="field">
                  <label className="label">Other (content)</label>
                  <input className="input" id="contentOther" placeholder="e.g., ramie blend" />
                </div>
              </div>
              <div className="error-text">Select a fabric content (or Unknown/Other).</div>
            </div>

            {/* Fabric Type */}
            <div className="field" data-field="type">
              <label className="label">Fabric Type (multi-select)</label>
              <div className="checklist" id="type-list">
                <label className="check">
                  <input type="checkbox" name="type" value="unknown" id="typeUnknown" /> Unknown
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="boucle" /> Bouclé
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="canvas" /> Canvas
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="chiffon" /> Chiffon
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="corduroy" /> Corduroy
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="crepe" /> Crepe
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="denim" /> Denim
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="gabardine" /> Gabardine
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="georgette" /> Georgette
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="jersey" /> Jersey
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="lace" /> Lace
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="leather" /> Leather
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="organza" /> Organza
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="poplin" /> Poplin
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="sateen" /> Sateen
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="satin" /> Satin
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="tulle" /> Tulle
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="tweed" /> Tweed
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="twill" /> Twill
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="velvet" /> Velvet
                </label>
                <label className="check">
                  <input type="checkbox" name="type" value="voile" /> Voile
                </label>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <div className="field">
                  <label className="label">Other (type)</label>
                  <input className="input" id="typeOther" placeholder="e.g., ottoman weave" />
                </div>
              </div>
              <div className="error-text">Select a fabric type (or Unknown/Other).</div>
            </div>

            {/* Condition + Pattern with extra space */}
            <div className="stack-gap">
              <div className="field">
                <label className="label">Condition</label>
                <div className="row">
                  <label className="check">
                    <input type="radio" name="condition" value="new" defaultChecked /> New
                  </label>
                  <label className="check">
                    <input type="radio" name="condition" value="washed" /> Washed
                  </label>
                  <label className="check">
                    <input type="radio" name="condition" value="used" /> Used
                  </label>
                  <label className="check">
                    <input type="radio" name="condition" value="unknown" /> Unknown
                  </label>
                </div>
              </div>
              <div className="field">
                <label className="label">Pattern</label>
                <div className="row">
                  <label className="check">
                    <input type="radio" name="pattern" value="solid" defaultChecked /> Solid
                  </label>
                  <label className="check">
                    <input type="radio" name="pattern" value="pattern" /> Pattern
                  </label>
                  <label className="check">
                    <input type="radio" name="pattern" value="unknown" /> Unknown
                  </label>
                </div>
              </div>
            </div>

            <div className="actions">
              <button type="button" className="btn btn-ghost" id="preview-btn">
                Preview
              </button>
              <button type="submit" className="btn btn-primary" id="publish-btn" disabled>
                Publish Listing
              </button>
            </div>
          </form>
        </section>

        {/* PREVIEW */}
        <aside className="card preview" aria-live="polite">
          <h2>Preview</h2>
          <div className="card-body" id="preview">
            <div className="thumb thumb--cotton" id="preview-thumb"></div>
            <h3 id="p-title" style={{ margin: "12px 0 6px" }}>
              Your Title
            </h3>
            <div className="meta" id="p-meta">
              0 yd • 0″ • —
            </div>
            <div className="price" id="p-price">
              $0 / yd
            </div>
            <div className="meta" id="p-tags" style={{ marginTop: 6 }}></div>
            <p className="meta" id="p-desc" style={{ marginTop: 8 }}></p>
          </div>
        </aside>
      </main>

      {/* ===== Styles (global) ===== */}
      <style jsx global>{`
        :root {
          --hm-charcoal: #333333;
          --hm-rosewood: #65000b;
          --hm-hunter: #355e3b;
          --hm-black: #000;
          --hm-bg: #fff;
          --hm-surface: #fff;
          --hm-text: var(--hm-charcoal);
          --hm-muted: #6b7280;
          --hm-header-h: 140px;
          --hm-radius: 14px;
          --hm-border: 1px solid rgba(0, 0, 0, 0.1);
          --hm-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
          --hm-cta-fg: #fff;
          --hm-cta-bg: var(--hm-rosewood);
          --hm-cta-bg-hover: #7e0a15;
          --hm-cta-secondary: var(--hm-hunter);
          --hm-error: #8b1c1c;
          --hm-error-bg: #fde8e8;
          --hm-ok: #155724;
          --hm-ok-bg: #e6f4ea;
          --hm-z-header: 70;
        }
        * {
          box-sizing: border-box;
        }
        html,
        body {
          margin: 0;
          background: var(--hm-bg);
          color: var(--hm-text);
          font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        }
        img {
          max-width: 100%;
          display: block;
        }
        a {
          text-decoration: none;
          color: var(--hm-black);
        }
        a:hover {
          color: var(--hm-rosewood);
        }

        .hm-header {
          position: sticky;
          top: 0;
          z-index: var(--hm-z-header);
          height: var(--hm-header-h);
          background: var(--hm-surface);
          border-bottom: var(--hm-border);
        }
        .hm-header-inner {
          height: 100%;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 18px;
          padding: 0 16px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .hm-logo img {
          height: 120px;
        }
        .hm-nav {
          display: flex;
          gap: 22px;
          align-items: center;
          justify-content: center;
        }
        .hm-nav a {
          padding: 8px 10px;
          border-radius: 10px;
          font-weight: 700;
          color: var(--hm-black);
        }
        .hm-nav a:hover {
          background: rgba(53, 94, 59, 0.1);
        }
        .hm-nav .cta {
          font-weight: 900;
          padding: 12px 18px;
          border-radius: 999px;
          background: var(--hm-cta-bg);
          color: var(--hm-cta-fg);
          border: 1px solid var(--hm-black);
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.06);
        }
        .hm-nav .cta:hover {
          background: var(--hm-cta-bg-hover);
        }
        .hm-icon {
          width: 18px;
          height: 18px;
          margin-right: 6px;
          vertical-align: -3px;
        }

        .container {
          max-width: 1200px;
          margin: 20px auto;
          padding: 0 16px;
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 24px;
        }
        @media (max-width: 980px) {
          .container {
            grid-template-columns: 1fr;
          }
        }
        .card {
          background: #fff;
          border: var(--hm-border);
          border-radius: 16px;
          box-shadow: var(--hm-shadow);
        }
        .card h2 {
          margin: 0;
          padding: 16px 18px;
          border-bottom: var(--hm-border);
        }
        .card-body {
          padding: 16px 18px;
        }
        .row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .row-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 640px) {
          .row,
          .row-3 {
            grid-template-columns: 1fr;
          }
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .label {
          font-weight: 700;
        }
        .hint {
          font-size: 12px;
          color: var(--hm-muted);
        }
        .input,
        .select,
        textarea {
          padding: 12px 14px;
          border: var(--hm-border);
          border-radius: 12px;
          font-size: 14px;
        }
        textarea {
          min-height: 140px;
          resize: vertical;
        }

        .checklist {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          max-height: 300px;
          overflow: auto;
          padding-right: 4px;
        }
        @media (max-width: 800px) {
          .checklist {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .check {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .check input {
          width: 16px;
          height: 16px;
        }

        .actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          margin-top: 10px;
        }
        .btn {
          border: var(--hm-border);
          background: #fff;
          border-radius: 12px;
          padding: 12px 16px;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-primary {
          background: var(--hm-cta-bg);
          color: #fff;
          border-color: var(--hm-black);
        }
        .btn-primary[disabled] {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-primary:hover {
          background: var(--hm-cta-bg-hover);
        }
        .btn-ghost {
          background: #fff;
        }

        .preview .thumb {
          width: 100%;
          height: 200px;
        }
        .thumb--wool {
          background: repeating-linear-gradient(45deg, #0000000d 0 8px, #ffffff10 8px 16px),
            linear-gradient(0deg, #d8d6d1, #e6e1db);
        }
        .thumb--silk {
          background: linear-gradient(135deg, #ffffff80, #ffffff00 40%),
            linear-gradient(315deg, #0000000d, #0000 45%), linear-gradient(0deg, #f2ede8, #e7e1db);
        }
        .thumb--cotton {
          background: repeating-linear-gradient(0deg, #00000008 0 2px, #0000 2px 4px),
            repeating-linear-gradient(90deg, #00000008 0 2px, #0000 2px 4px), linear-gradient(0deg, #e9e9e9, #f5f5f5);
        }
        .thumb--sateen {
          background: linear-gradient(90deg, #ffffffb3 0 20%, #ffffff00 40% 60%, #ffffff99 80% 100%),
            linear-gradient(0deg, #dedfe6, #cfd3de);
        }
        .thumb--crepe {
          background: radial-gradient(circle at 20% 30%, #0000000f 0 12%, #0000 13%),
            radial-gradient(circle at 70% 60%, #0000000d 0 10%, #0000 11%), linear-gradient(0deg, #e6e3e1, #f0eeeb);
        }
        .meta {
          color: var(--hm-muted);
          font-size: 13px;
        }
        .price {
          font-weight: 800;
        }

        .error-banner {
          display: none;
          margin-bottom: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--hm-error-bg);
          color: var(--hm-error);
          border: 1px solid #f5c2c7;
        }
        .error-banner.show {
          display: block;
        }
        .ok-banner {
          display: none;
          margin-bottom: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--hm-ok-bg);
          color: var(--hm-ok);
          border: 1px solid #b7e1c1;
        }
        .ok-banner.show {
          display: block;
        }
        .field.error .input,
        .field.error .select,
        .field.error textarea {
          border-color: #cc3c3c;
          box-shadow: 0 0 0 3px rgba(204, 60, 60, 0.1);
        }
        .field .error-text {
          display: none;
          font-size: 12px;
          color: var(--hm-error);
        }
        .field.error .error-text {
          display: block;
        }

        /* Images Uploader */
        .uploader {
          border: 2px dashed rgba(0, 0, 0, 0.15);
          border-radius: 14px;
          padding: 14px;
          text-align: center;
          background: #fafafa;
        }
        .uploader.drag {
          background: #f1f7f3;
          border-color: var(--hm-hunter);
        }
        .uploader input[type="file"] {
          display: none;
        }
        .uploader .btn {
          margin-top: 8px;
        }
        .thumbs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }
        .thumbs .t {
          position: relative;
          border: var(--hm-border);
          border-radius: 12px;
          overflow: hidden;
          background: #fff;
        }
        .thumbs img {
          width: 100%;
          height: 120px;
          object-fit: cover;
          display: block;
        }
        .thumbs .handle {
          position: absolute;
          inset: auto 6px 6px auto;
          background: #fff;
          border: var(--hm-border);
          border-radius: 8px;
          padding: 4px 8px;
          font-size: 12px;
          cursor: grab;
        }
        .thumbs .remove {
          position: absolute;
          top: 6px;
          right: 6px;
          background: #fff;
          border: var(--hm-border);
          border-radius: 999px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .thumbs .t[draggable="true"] {
          cursor: grab;
        }
        .thumbs .t.dragging {
          opacity: 0.6;
        }

        .stack-gap {
          display: grid;
          gap: 18px;
        }
      `}</style>
    </>
  );
}
