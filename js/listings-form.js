// js/listings-form.js
(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.HEMLINE_ENV || {};
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    alert("Missing Supabase env (see js/env.js).");
    return;
  }
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const form = document.getElementById("listing-form");
  const preview = document.getElementById("preview");
  const ok = document.getElementById("ok");
  const fail = document.getElementById("fail");
  const submitBtn = document.getElementById("submitBtn");
  const fileInput = document.getElementById("images");

  // Simple preview of up to 6 images
  fileInput?.addEventListener("change", () => {
    preview.innerHTML = "";
    const files = [...fileInput.files].slice(0, 6);
    files.forEach(f => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      preview.appendChild(img);
    });
  });

  // Upload images to storage bucket listing-images
  async function uploadImages(files) {
    const max = Math.min(files.length, 6);
    const urls = [];
    for (let i = 0; i < max; i++) {
      const f = files[i];
      if (f.size > 8 * 1024 * 1024) throw new Error(`${f.name} is over 8MB. Pick a smaller file.`);
      const safeName = f.name.replace(/[^\w.\-]/g, "_");
      const path = `listings/${Date.now()}_${i}_${safeName}`;
      const { error } = await supabase
        .storage.from("listing-images")
        .upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type || "image/jpeg" });
      if (error) throw new Error(error.message);
      const { data: pub } = supabase.storage.from("listing-images").getPublicUrl(path);
      urls.push(pub.publicUrl);
    }
    return urls;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    ok.style.display = "none";
    fail.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      const files = fileInput?.files || [];
      const image_urls = files.length ? await uploadImages(files) : [];

      const payload = {
        p_title: document.getElementById("title").value.trim(),
        p_description: document.getElementById("description").value.trim(),
        p_price: Number(document.getElementById("price").value),
        p_category: document.getElementById("category").value || null,
        p_color: document.getElementById("color").value || null,
        p_item_type: document.getElementById("item_type").value || null,
        p_image_urls: image_urls
      };

      if (!payload.p_title) throw new Error("Title is required.");
      if (!Number.isFinite(payload.p_price)) throw new Error("Price must be a number.");

      // Call secured DB function (acts like a backend endpoint)
      const { data, error } = await supabase.rpc("create_listing", payload);
      if (error) throw new Error(error.message);

      ok.style.display = "block";
      form.reset();
      preview.innerHTML = "";
    } catch (err) {
      console.error(err);
      fail.textContent = "Error: " + err.message;
      fail.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Listing";
    }
  });
})();
