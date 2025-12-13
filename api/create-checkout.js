// /api/create-checkout.js
import mercadopago from "mercadopago";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

// ==========================
// Config Mercado Pago
// ==========================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_NOTIFICATION_URL = process.env.MP_NOTIFICATION_URL;

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { name, email, paymentMethod } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        error: "Nome e e-mail são obrigatórios",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const method = paymentMethod === "pix" ? "pix" : "card";

    // ==========================
    // 1️⃣ Cria pedido no Supabase
    // ==========================
    const { data: order, error: insertError } = await supabaseAdmin
      .from("ebook_order")
      .insert({
        name,
        email: cleanEmail,
        status: "pending",
        download_allowed: false,
        mp_status: "init",
      })
      .select("id")
      .single();

    if (insertError || !order?.id) {
      console.error("❌ Erro ao criar pedido:", insertError);
      return res.status(500).json({
        error: "Erro ao criar pedido no sistema",
      });
    }

    const orderId = order.id;

    // ==========================
    // 2️⃣ URLs de retorno (CRÍTICO)
    // ==========================
    const baseDownloadUrl = "https://octopusaxisebook.com/download.html";
    const downloadUrl =
      baseDownloadUrl +
      "?email=" +
      encodeURIComponent(cleanEmail) +
      "&orderId=" +
      encodeURIComponent(orderId);

    // ==========================
    // 3️⃣ Preferência MP
    // ==========================
    const preference = {
      external_reference: String(orderId), // 🔑 liga MP ↔ Supabase
      notification_url: MP_NOTIFICATION_URL,

      back_urls: {
        success: downloadUrl,
        pending: downloadUrl,
        failure: downloadUrl,
      },

      auto_return: "approved",

      items: [
        {
          id: "ebook-musica-ansiedade",
          title: "E-book Música & Ansiedade",
          description: "Série Música & Medicina",
          quantity: 1,
          unit_price: 129,
          currency_id: "BRL",
        },
      ],

      payer: {
        name,
        email: cleanEmail,
      },

      payment_methods:
        method === "pix"
          ? {
              default_payment_method_id: "pix",
              excluded_payment_types: [{ id: "ticket" }],
            }
          : {
              excluded_payment_types: [{ id: "ticket" }],
              excluded_payment_methods: [{ id: "pix" }],
            },
    };

    // ==========================
    // 4️⃣ Cria checkout MP
    // ==========================
    const mpResponse = await mercadopago.preferences.create(preference);

    const initPoint = mpResponse?.body?.init_point;
    const prefId = mpResponse?.body?.id;

    if (!initPoint || !prefId) {
      console.error("❌ Resposta inválida do MP:", mpResponse?.body);
      return res.status(500).json({
        error: "Erro ao criar checkout no Mercado Pago",
      });
    }

    // ==========================
    // 5️⃣ Atualiza pedido
    // ==========================
    await supabaseAdmin
      .from("ebook_order")
      .update({
        mp_external_reference: String(orderId),
        mp_preference_id: String(prefId),
        mp_raw: mpResponse.body,
      })
      .eq("id", orderId);

    // ==========================
    // 6️⃣ Retorno para o front
    // ==========================
    return res.status(200).json({
      initPoint,
      orderId,
    });
  } catch (err) {
    console.error("🔥 Erro interno create-checkout:", err);
    return res.status(500).json({
      error: "Erro interno ao iniciar checkout",
    });
  }
}
