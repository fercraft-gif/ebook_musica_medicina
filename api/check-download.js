// /api/check-download.js
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

/**
 * check-download
 *
 * Verifica no Supabase se o pedido já está liberado para download.
 * 
 * Fluxo sugerido no front:
 * - Chamar /api/check-download?email=...&orderId=... (GET)
 * - Receber { allowed: true/false, status, mpStatus, orderId }
 * - Se allowed === true → mostrar botão/link de download
 */

export default async function handler(req, res) {
  // Vamos trabalhar com GET pra ficar simples de usar no obrigado.html
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { email, orderId } = req.query || {};

    if (!email) {
      return res.status(400).json({
        step: 'validation',
        error: 'E-mail é obrigatório para checar o download.',
      });
    }

    // 1) Monta a query base
    let query = supabaseAdmin
      .from('ebook_order')
      .select('id, status, download_allowed, mp_status')
      .eq('email', email);

    // Se vier um orderId específico, filtra por ele
    if (orderId) {
      query = query.eq('id', orderId);
    }

    // Ordena para pegar o pedido "mais recente"
    // (sem created_at, usamos id como critério estável)
    query = query.order('id', { ascending: false }).limit(1);

    const { data, error } = await query;

    if (error) {
      console.error(
        'Erro Supabase ao buscar pedido em check-download:',
        JSON.stringify(error, null, 2)
      );

      return res.status(500).json({
        step: 'supabase-select',
        error: 'Erro ao buscar pedido no Supabase.',
        details: error.message || error,
      });
    }

    if (!data || data.length === 0) {
      // Nenhum pedido encontrado para esse e-mail (ou orderId)
      return res.status(200).json({
        found: false,
        allowed: false,
        status: null,
        mpStatus: null,
        orderId: null,
        message: 'Nenhum pedido encontrado para este e-mail.',
      });
    }

    const order = data[0];

    const allowed = !!order.download_allowed;
    const status = order.status; // ex.: 'paid', 'pending', 'canceled'
    const mpStatus = order.mp_status; // ex.: 'approved', 'pending', etc.
    const currentOrderId = order.id;

    // 2) Retorna status para o front
    return res.status(200).json({
      found: true,
      allowed,
      status,
      mpStatus,
      orderId: currentOrderId,
    });
  } catch (err) {
    console.error('Erro inesperado em /api/check-download:', err);

    return res.status(500).json({
      step: 'unknown',
      error: 'Erro interno ao verificar download.',
      details: err?.message || String(err),
    });
  }
}
