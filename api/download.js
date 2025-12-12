// /api/download.js
import mercadopago from "mercadopago";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

/**
 * /api/download
 *
 * - Busca pedido no Supabase pelo e-mail (ou orderId)
 * - Se download_allowed=true -> gera signed URL
 * - Se download_allowed=false -> tenta reconciliar com Mercado Pago (fallback do webhook)
 *    - procura pagamento aprovado por external_reference=orderId
 *    - se achar approved, atualiza Supabase e libera na hora
 */

// ⚠ CONFIRA estes valores no Supabase Storage
const EBOOK_BUCKET = process.env.EBOOK_BUCKET || "ebook_musica_medicina";
const EBOOK_MAIN_PATH = process.env.EBOOK_MAIN_PATH || "musica-e-ansiedade.pdf";

// Tempo de expiração do link (em segundos) – aqui 2 horas
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 2;

// MP
const accessToken = process.env.MP_ACCESS_TOKEN;
if (!accessToken) {
  console.error("MP_ACCESS_TOKEN não configurado na Vercel!");
} else {
  mercadopago.configure({ access_token: accessToken });
}

async function createEbookSignedUrl() {
  const { data: ebookSigned, error: ebookSignedError } = await supabaseAdmin.storage
    .from(EBOOK_BUCKET)
    .createSignedUrl(EBOOK_MAIN_PATH, SIGNED_URL_EXPIRES_IN);

  if (ebookSignedError) {
    throw new Error(ebookSignedError.message || "Erro ao criar signed URL.");
  }

  const ebookUrl = ebookSigned?.signedUrl;
  if (!ebookUrl) throw new Error("Signed URL vazia.");

  return ebookUrl;
}

/**
 * Reconciliador:
 * tenta achar pagamento aprovado no Mercado Pago usando external_reference = orderId
 */
async function reconcileWithMercadoPago(orderId) {
  if (!accessToken) return { reconciled: false, reason: "no-mp-token" };

  try {
    // Busca pagamentos pela referência externa (Mercado Pago permite search)
    const searchResp = await mercadopago.payment.search({
      qs: {
        external_reference: String(orderId),
        sort: "date_created",
        criteria: "desc",
        limit: 10,
      },
    });

    const results = searchResp?.body?.results || [];
    if (!results.length) {
      return { reconciled: false, reason: "no-payments-found" };
    }

    // pega o mais recente
    const p = results[0];
    const status = p.status;
    const paymentId = p.id;

    return {
      reconciled: status === "approved",
      status,
      paymentId: paymentId ? String(paymentId) : null,
    };
  } catch (e) {
    console.error("Erro ao reconciliar com MP:", e);
    return { reconciled: false, reason: "mp-search-error" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { email, orderId } = req.query || {};

    if (!email && !orderId) {
      return res.status(400).json({
        step: "validation",
        error: "Informe e-mail (ou orderId) para localizar seu pedido.",
      });
    }

    const emailClean = email ? String(email).trim() : null;
    const orderIdClean = orderId ? String(orderId).trim() : null;

    console.log("🔍 [/api/download] Buscando pedido para:", {
      email: emailClean,
      orderId: orderIdClean,
    });

    // 1) Busca o pedido do usuário
    let query = supabaseAdmin
      .from("ebook_order")
      .select("id, status, download_allowed, mp_status, email");

    if (orderIdClean) {
      query = query.eq("id", orderIdClean);
    } else {
      query = query.ilike("email", emailClean);
    }

    query = query.order("id", { ascending: false }).limit(1);

    const { data, error } = await query;

    if (error) {
      console.error("❌ Erro Supabase em /api/download:", JSON.stringify(error, null, 2));
      return res.status(500).json({
        step: "supabase-select",
        error: "Erro ao buscar pedido no Supabase.",
        details: error.message || error,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        found: false,
        allowed: false,
        error: "Nenhum pedido encontrado.",
      });
    }

    let order = data[0];
    console.log("📦 Pedido encontrado:", order);

    // 2) Se não liberou, tenta reconciliar com MP (fallback)
    if (!order.download_allowed) {
      console.log("⏳ Ainda não liberado. Tentando reconciliar com MP…", { id: order.id });

      const rec = await reconcileWithMercadoPago(order.id);

      console.log("🔁 Resultado reconciliação:", rec);

      if (rec.reconciled) {
        // Atualiza Supabase (idempotente)
        const { error: updErr } = await supabaseAdmin
          .from("ebook_order")
          .update({
            status: "approved",
            mp_status: "approved",
            download_allowed: true,
            // se você não tiver essa coluna, remova:
            // mp_payment_id: rec.paymentId,
          })
          .eq("id", String(order.id));

        if (updErr) {
          console.error("❌ Erro ao atualizar pedido após reconciliação:", updErr);
          // Mesmo assim, não libera — precisa consistência
          return res.status(200).json({
            found: true,
            allowed: false,
            status: order.status,
            mpStatus: order.mp_status,
            orderId: order.id,
            message:
              "Seu pagamento parece aprovado, mas houve erro ao atualizar o sistema. Tente novamente em instantes.",
          });
        }

        // Recarrega estado local
        order = { ...order, status: "approved", mp_status: "approved", download_allowed: true };
        console.log("✅ Pedido reconciliado e liberado:", order.id);
      } else {
        // continua pendente
        return res.status(200).json({
          found: true,
          allowed: false,
          status: order.status,
          mpStatus: order.mp_status,
          orderId: order.id,
          message:
            "Seu pagamento ainda não foi confirmado. Se você já pagou, aguarde alguns minutos e recarregue esta página.",
          debug: rec.reason ? rec.reason : undefined, // pode remover depois
        });
      }
    }

    // 3) Agora está liberado: gera signed URL
    const ebookUrl = await createEbookSignedUrl();

    return res.status(200).json({
      found: true,
      allowed: true,
      status: order.status,
      mpStatus: order.mp_status,
      orderId: order.id,
      ebookUrl,
      expiresInSeconds: SIGNED_URL_EXPIRES_IN,
    });
  } catch (err) {
    console.error("🔥 Erro inesperado em /api/download:", err);
    return res.status(500).json({
      step: "unknown",
      error: "Erro interno ao gerar link de download.",
      details: err?.message || String(err),
    });
  }
}
