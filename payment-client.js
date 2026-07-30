(() => {
  const apiBase = String(window.ACIK_PAYMENT_API_BASE || "").replace(/\/$/, "");
  if (!apiBase) return;

  const form = document.getElementById("checkoutForm");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const submitButton = form.querySelector('button[type="submit"]');
    const originalLabel = submitButton?.textContent || "Bayar dengan selamat";

    try {
      const fields = Object.fromEntries(new FormData(form).entries());
      const savedCart = JSON.parse(localStorage.getItem("acikVeganCart") || "{}");
      const items = Object.entries(savedCart)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([id, qty]) => ({ id, qty: Number(qty) }));

      if (!items.length) throw new Error("Troli anda kosong.");
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Menyediakan halaman pembayaran…";
      }

      const response = await fetch(`${apiBase}/api/create-bill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: fields.name,
            phone: fields.phone,
            email: fields.email,
            address: fields.address,
            postcode: fields.postcode,
            delivery: fields.delivery,
            payment: fields.payment
          },
          items
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) {
        throw new Error(result.error || "Billplz tidak dapat menyediakan bil pembayaran.");
      }

      localStorage.setItem("acikVeganPendingOrder", JSON.stringify({
        reference: result.reference,
        billId: result.id,
        amountCents: result.amountCents,
        createdAt: new Date().toISOString()
      }));
      window.location.assign(result.url);
    } catch (error) {
      alert(`${error.message}\n\nSila semak butiran pesanan dan cuba lagi.`);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  }, true);
})();
