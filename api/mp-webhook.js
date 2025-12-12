// /api/mp-webhook.js
import mercadopago from "mercadopago";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { log, warn, error } from "../lib/logger.js";

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) error("MP_ACCESS_TOKEN não configurado!");
else mercadopago.configure({ access_token: accessToken });

function getQueryParam(req, key) {
  return req?.query?.[key] ?? req?.query?.[key.replace(".", "")];
}

export default async function handler(req, res) {
  // MP pode dar GET de teste
  if (req.method === "GET") return res.status(200).send("ok");
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método não permitido" });

  try {
    const body = req.body || {};
    const query = req.query || {};

   // Logs essenciais (sem vazar payload)
   log("[MP WEBHOOK] method:", req.method);
   log("[MP WEBHOOK] event:", {
     topic: body?.type || body?.topic || query?.type || query?.topic || null,
     hasDataId: !!(body?.data?.id || query?.["data.id"] || query?.id),
});


    const topic = body.type || body.topic || query.type || query.topic;

    // MP às vezes manda o id assim: ?data.id=123
    const dataIdFromBody = body?.data?.id;
    const dataIdFromQuery =
      getQueryParam(req, "data.id") || query["data.id"] || query.id;

    const dataId = dataIdFromBody || dataIdFromQuery;

    let paymentId = null;

    // Caso: payment
    if (topic === "payment" && dataId) {
      paymentId = dataId;
    }

    // Caso: merchant_order (muito comum em cartão)
    if (!paymentId && topic === "merchant_order" && dataId) {
      const mo = await mercadopago.merchant_orders.findById(dataId);
      const payments = mo?.body?.payments || [];
      if (payments.length) paymentId = payments[payments.length - 1].id;
    }

    if (!paymentId) {
      warn("[MP WEBHOOK] ignored: no-payment-id", { topic, dataId });
      return res.status(200).json({
        ignored: true,
        reason: "no-payment-id",
        topic,
        dataId,
      });
    }

    // Busca pagamento completo
    const payResp = await mercadopago.payment.findById(paymentId);
    const payment = payResp?.body;

    if (!payment) {
      console.log("[MP WEBHOOK] ignored: payment-not-found", { paymentId });
      return res.status(200).json({
        ignored: true,
        reason: "payment-not-found",
        paymentId,
      });
    }

    const status = payment.status; // approved, pending, rejected...
    const externalRef =
      payment.external_reference || payment?.metadata?.order_id;

    console.log("[MP WEBHOOK] payment:", {
      paymentId,
      status,
      external_reference: externalRef,
      payment_method_id: payment.payment_method_id,
    });

    if (!externalRef) {
      console.error("[MP WEBHOOK] sem external_reference — não dá pra casar pedido");
      return res.status(200).json({
        ignored: true,
        reason: "no-external-reference",
        paymentId,
        status,
      });
    }

    // Atualiza pedido (fala o MESMO idioma do seu create-checkout.js)
    const updateData = {
      status: status === "approved" ? "approved" : "pending",
      mp_status: status,
      download_allowed: status === "approved",
      // se você NÃO tiver essas colunas, pode remover:
      // mp_payment_id: String(paymentId),
    };

    const { error } = await supabaseAdmin
      .from("ebook_order")
      .update(updateData)
      .eq("id", String(externalRef));

    if (error) {
      error("[MP WEBHOOK] Supabase update error:", error);
      return res.status(200).json({ ok: false, supabase_error: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    error("[MP WEBHOOK] erro geral:", err);
    // 200 pra evitar tempestade de retry do MP
    return res.status(200).json({ ok: false });
  }
}
