// /api/mp-webhook.js
import mercadopago from "mercadopago";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

// ==========================
// Config Mercado Pago
// ==========================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!MP_ACCESS_TOKEN) {
  console.error("❌ MP_ACCESS_TOKEN não configurado");
}

mercadopago.configure({
  access_token: MP_ACCESS_TOKEN,
});

// ==========================
// Handler
// ==========================
export default async function handler(req, res) {
  try {
    // MP pode enviar GET ou POST
    const topic =
      req.query?.topic ||
      req.body?.type ||
      (req.body?.resource?.includes("payment") ? "payment" : null);

    const paymentId =
      req.query?.id ||
      req.body?.data?.id ||
      req.body?.id;

    // Se não for pagamento, ignora
    if (topic !== "payment" || !paymentId) {
      return res.status(200).json({ ok: true });
    }

    // ==========================
    // 1️⃣ Busca pagamento no MP
    // ==========================
    const payment = await mercadopago.payment.findById(paymentId);
    const data = payment?.body;

    if (!data) {
      console.error("❌ Pagamento não encontrado no MP:", paymentId);
      return res.status(200).json({ ok: true });
    }

    const mpStatus = data.status; // approved | pending | rejected
    const orderId = data.external_reference;

    if (!orderId) {
      console.error("❌ Pagamento sem external_reference:", data);
      return res.status(200).json({ ok: true });
    }

    const isApproved = mpStatus === "approved";

    // ==========================
    // 2️⃣ Atualiza pedido no Supabase
    // ==========================
    const { error } = await supabaseAdmin
      .from("ebook_order")
      .update({
        status: isApproved ? "approved" : "pending",
        mp_status: mpStatus,
        mp_payment_id: String(paymentId),
        download_allowed: isApproved,
        mp_raw: data,
      })
      .eq("id", String(orderId));

    if (error) {
      console.error("❌ Erro ao atualizar pedido:", error);
    } else {
      console.log("✅ Webhook MP aplicado:", {
        orderId,
        mpStatus,
        download_allowed: isApproved,
      });
    }

    // ==========================
    // 3️⃣ Resposta obrigatória
    // ==========================
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("🔥 Erro no mp-webhook:", err);
    // SEMPRE 200 para o MP
    return res.status(200).json({ ok: true });
  }
}
