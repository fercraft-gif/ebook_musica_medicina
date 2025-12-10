// /api/mp-webhook.js
import mercadopago from 'mercadopago';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// ⚙️ Credenciais (mesmo padrão do create-checkout)
const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  console.error('MP_ACCESS_TOKEN não configurado na Vercel (mp-webhook)!');
} else {
  mercadopago.configure({
    access_token: accessToken,
  });
}

/**
 * Webhook do Mercado Pago
 *
 * - Recebe notificações do MP
 * - Busca o pagamento pelo ID
 * - Lê o external_reference (id do pedido na ebook_order)
 * - Atualiza status / download_allowed no Supabase
 */
export default async function handler(req, res) {
  // Mercado Pago normalmente envia POST, mas deixamos GET em modo "OK" pra evitar erro 500
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { method, query, body } = req;

    // Log básico de segurança (sem travar fluxo)
    console.log('🔔 MP Webhook recebido:', {
      method,
      query,
      body,
    });

    // 1) Extrai paymentId e "topic/type" em formatos possíveis
    let paymentId = null;
    let topic = null;

    if (method === 'GET') {
      // Formato antigo de IPN
      paymentId = query['data.id'] || query.id || null;
      topic = query.topic || query.type || null;
    } else if (method === 'POST') {
      // Formato novo de webhook
      paymentId = body?.data?.id || body?.id || null;
      topic = body?.type || body?.topic || body?.action || null;
    }

    // Se não veio nada que pareça pagamento, só confirma 200 para não gerar retries infinitos
    if (!paymentId) {
      console.warn('Webhook sem paymentId. Ignorando com 200 OK.');
      return res.status(200).json({ ignored: true, reason: 'no-payment-id' });
    }

    console.log('🔍 Buscando pagamento no Mercado Pago:', { paymentId, topic });

    // 2) Busca o pagamento no Mercado Pago
    let paymentResponse;
    try {
      // SDK v1 – payments
      paymentResponse = await mercadopago.payment.findById(paymentId);
    } catch (mpErr) {
      if (mpErr?.response) {
        console.error(
          'Erro Mercado Pago (payment.findById): status',
          mpErr.response.status,
          'body',
          JSON.stringify(mpErr.response.body, null, 2)
        );
      } else {
        console.error('Erro Mercado Pago (payment.findById):', mpErr);
      }

      // Mesmo com erro, devolvemos 200 para evitar loop de notificações
      return res.status(200).json({
        success: false,
        step: 'mp-payment',
        error: 'Erro ao buscar pagamento no Mercado Pago.',
        details: mpErr?.response?.body || mpErr?.message || String(mpErr),
      });
    }

    const payment = paymentResponse?.body;

    if (!payment) {
      console.error(
        'Resposta inesperada ao buscar pagamento:',
        JSON.stringify(paymentResponse || {}, null, 2)
      );
      return res.status(200).json({
        success: false,
        step: 'mp-payment',
        error: 'Pagamento não encontrado ou resposta vazia do Mercado Pago.',
      });
    }

    const externalRef = payment.external_reference;
    const mpStatus = payment.status; // approved, pending, rejected, etc.
    const statusDetail = payment.status_detail;

    console.log('✅ Pagamento encontrado:', {
      paymentId,
      externalRef,
      mpStatus,
      statusDetail,
    });

    if (!externalRef) {
      // Sem external_reference não temos como casar com a tabela
      console.error('Pagamento sem external_reference. Não dá pra vincular à ebook_order.');
      return res.status(200).json({
        success: false,
        step: 'no-external-ref',
        error: 'Pagamento sem external_reference. Não foi possível vincular ao pedido.',
      });
    }

    // 3) Mapeia status do MP para status interno e permissão de download
    let appStatus = 'pending'; // nossa coluna "status" na ebook_order
    let downloadAllowed = false;

    switch (mpStatus) {
      case 'approved':
        appStatus = 'paid';
        downloadAllowed = true;
        break;
      case 'cancelled':
      case 'rejected':
      case 'refunded':
      case 'charged_back':
        appStatus = 'canceled';
        downloadAllowed = false;
        break;
      default:
        // pending, in_process, etc.
        appStatus = 'pending';
        downloadAllowed = false;
        break;
    }

    // 4) Atualiza a linha correspondente na tabela ebook_order
    const { error: supaUpdateError } = await supabaseAdmin
      .from('ebook_order')
      .update({
        status: appStatus, // ex.: 'paid', 'pending', 'canceled'
        download_allowed: downloadAllowed,
        mp_status: mpStatus, // status bruto do MP (approved, pending, etc.)
      })
      .eq('id', externalRef);

    if (supaUpdateError) {
      console.error(
        'Erro ao atualizar ebook_order via webhook:',
        JSON.stringify(supaUpdateError, null, 2)
      );

      // Ainda devolvemos 200 para não ficar loopando, mas indicando erro no JSON
      return res.status(200).json({
        success: false,
        step: 'supabase-update',
        error: 'Erro ao atualizar pedido no Supabase.',
        details: supaUpdateError.message || supaUpdateError,
      });
    }

    console.log('📦 Pedido atualizado com sucesso no Supabase via webhook:', {
      orderId: externalRef,
      appStatus,
      downloadAllowed,
      mpStatus,
    });

    // 5) Responde 200 para o Mercado Pago
    return res.status(200).json({
      success: true,
      step: 'done',
      paymentId,
      orderId: externalRef,
      mpStatus,
      statusDetail,
      appStatus,
      downloadAllowed,
    });
  } catch (err) {
    console.error('Erro inesperado em /api/mp-webhook:', err);

    // NÃO retornar 500 para o MP, pra evitar retries infinitos
    return res.status(200).json({
      success: false,
      step: 'unknown',
      error: 'Erro interno no webhook.',
      details: err?.message || String(err),
    });
  }
}
