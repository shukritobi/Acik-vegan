// Cloudflare Worker backend for Acik Vegan + Billplz.
// Bind a KV namespace named ORDERS and configure the environment values listed below.
// Never place the Billplz secret in the public GitHub Pages frontend.

const PRODUCTS = Object.freeze({
  edamame: { name: "Tempe Edamame", priceCents: 1400 },
  "soya-putih": { name: "Tempe Soya Putih", priceCents: 900 },
  "soya-hitam": { name: "Tempe Soya Hitam", priceCents: 1300 },
  "kacang-kuda": { name: "Tempe Kacang Kuda", priceCents: 1300 },
  "lima-kacang": { name: "Tempe Lima Jenis Kacang", priceCents: 1500 }
});

const json = (body, status = 200, origin = "*") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
    "cache-control": "no-store"
  }
});

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return origin === env.ALLOWED_ORIGIN ? origin : "";
}

function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

function validateAndPriceOrder(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid order payload.");
  const name = String(payload.customer?.name || "").trim().slice(0, 255);
  const email = String(payload.customer?.email || "").trim().slice(0, 255);
  const mobile = normalizeMobile(payload.customer?.phone);
  const address = String(payload.customer?.address || "").trim().slice(0, 500);
  const postcode = String(payload.customer?.postcode || "").replace(/\D/g, "").slice(0, 5);
  const delivery = String(payload.customer?.delivery || "8") === "0" ? 0 : 800;

  if (!name || !mobile || !address || postcode.length !== 5) {
    throw new Error("Name, Malaysian mobile number, address, and five-digit postcode are required.");
  }

  const incomingItems = Array.isArray(payload.items) ? payload.items : [];
  const items = incomingItems.map(item => {
    const product = PRODUCTS[String(item.id || "")];
    const quantity = Math.max(1, Math.min(20, Number.parseInt(item.qty, 10) || 0));
    if (!product) throw new Error("Unknown product in order.");
    return {
      id: String(item.id),
      name: product.name,
      qty: quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * quantity
    };
  });

  if (!items.length) throw new Error("The cart is empty.");
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const totalCents = subtotalCents + delivery;
  if (totalCents < 100 || totalCents > 500000) throw new Error("Order amount is outside the accepted range.");

  return { name, email, mobile, address, postcode, items, subtotalCents, shippingCents: delivery, totalCents };
}

function basicAuth(secret) {
  return `Basic ${btoa(`${secret}:`)}`;
}

async function createBill(request, env, origin) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400, origin);
  }

  let order;
  try {
    order = validateAndPriceOrder(payload);
  } catch (error) {
    return json({ error: error.message }, 400, origin);
  }

  const reference = `AV-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
  const description = order.items.map(item => `${item.qty}x ${item.name}`).join(", ").slice(0, 200);
  const callbackUrl = `${new URL(request.url).origin}/api/callback`;
  const redirectUrl = `${env.SITE_URL.replace(/\/$/, "")}/payment-result.html`;
  const apiBase = (env.BILLPLZ_API_BASE || "https://www.billplz-sandbox.com").replace(/\/$/, "");

  const form = new URLSearchParams({
    collection_id: env.BILLPLZ_COLLECTION_ID,
    name: order.name,
    mobile: order.mobile,
    email: order.email || "orders@acikvegan.invalid",
    amount: String(order.totalCents),
    description,
    callback_url: callbackUrl,
    redirect_url: redirectUrl,
    deliver: "false",
    reference_1_label: "Order",
    reference_1: reference,
    reference_2_label: "Postcode",
    reference_2: order.postcode
  });

  const billResponse = await fetch(`${apiBase}/api/v3/bills`, {
    method: "POST",
    headers: {
      "authorization": basicAuth(env.BILLPLZ_SECRET_KEY),
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json"
    },
    body: form
  });

  const bill = await billResponse.json().catch(() => null);
  if (!billResponse.ok || !bill?.id || !bill?.url) {
    return json({ error: "Unable to create Billplz bill.", details: bill }, 502, origin);
  }

  const record = {
    reference,
    billId: bill.id,
    status: "due",
    amountCents: order.totalCents,
    customer: { name: order.name, email: order.email, mobile: order.mobile, address: order.address, postcode: order.postcode },
    items: order.items,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    createdAt: new Date().toISOString()
  };

  await env.ORDERS.put(`bill:${bill.id}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 180 });
  return json({ id: bill.id, reference, url: bill.url, amountCents: order.totalCents }, 201, origin);
}

async function verifyBillWithBillplz(id, env) {
  const apiBase = (env.BILLPLZ_API_BASE || "https://www.billplz-sandbox.com").replace(/\/$/, "");
  const response = await fetch(`${apiBase}/api/v3/bills/${encodeURIComponent(id)}`, {
    headers: { "authorization": basicAuth(env.BILLPLZ_SECRET_KEY), "accept": "application/json" }
  });
  if (!response.ok) return null;
  return response.json();
}

async function callback(request, env) {
  const form = await request.formData();
  const id = String(form.get("id") || "");
  if (!id) return new Response("Missing bill id", { status: 400 });

  const existingRaw = await env.ORDERS.get(`bill:${id}`);
  if (!existingRaw) return new Response("Unknown bill", { status: 404 });
  const existing = JSON.parse(existingRaw);
  const verified = await verifyBillWithBillplz(id, env);

  if (!verified || Number(verified.amount) !== Number(existing.amountCents)) {
    return new Response("Unable to verify bill", { status: 400 });
  }

  existing.status = verified.paid === true && verified.state === "paid" ? "paid" : String(verified.state || "due");
  existing.paidAmountCents = Number(verified.paid_amount || 0);
  existing.paidAt = verified.paid_at || null;
  existing.updatedAt = new Date().toISOString();
  await env.ORDERS.put(`bill:${id}`, JSON.stringify(existing), { expirationTtl: 60 * 60 * 24 * 365 });
  return new Response("OK", { status: 200 });
}

async function status(request, env, origin, id) {
  const stored = await env.ORDERS.get(`bill:${id}`, "json");
  if (!stored) return json({ error: "Order not found." }, 404, origin);

  const verified = await verifyBillWithBillplz(id, env);
  if (verified && Number(verified.amount) === Number(stored.amountCents)) {
    stored.status = verified.paid === true && verified.state === "paid" ? "paid" : String(verified.state || stored.status);
    stored.paidAmountCents = Number(verified.paid_amount || 0);
    stored.paidAt = verified.paid_at || stored.paidAt || null;
    stored.updatedAt = new Date().toISOString();
    await env.ORDERS.put(`bill:${id}`, JSON.stringify(stored), { expirationTtl: 60 * 60 * 24 * 365 });
  }

  return json({
    reference: stored.reference,
    billId: stored.billId,
    status: stored.status,
    amountCents: stored.amountCents,
    paidAmountCents: stored.paidAmountCents || 0,
    paidAt: stored.paidAt || null
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    if (url.pathname === "/api/callback" && request.method === "POST") return callback(request, env);
    if (!origin) return json({ error: "Origin not allowed." }, 403, "null");
    if (url.pathname === "/api/create-bill" && request.method === "POST") return createBill(request, env, origin);
    if (url.pathname.startsWith("/api/order/") && request.method === "GET") {
      return status(request, env, origin, url.pathname.split("/").pop());
    }

    return json({ service: "Acik Vegan Billplz backend", status: "ready" }, 200, origin);
  }
};
