// /api/download.js
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { log, warn, error as logError } from '../lib/logger.js';

/**
 * /api/download
 *
 * - Confere no Supabase se há um pedido para o e-mail informado
 * - Verifica se download_allowed = true (pagamento aprovado / liberado)
 * - Se estiver liberado, gera URL assinada do PDF no Storage
 * - Retorna as infos em JSON para o front abrir automaticamente
 */

// ⚠ CONFIRA estes valores no Supabase Storage
const EBOOK_BUCKET = process.env.EBOOK_BUCKET || 'ebook_musica_medicina';
const EBOOK_MAIN_PATH = process.env.EBOOK_MAIN_PATH || 'musica-e-ansiedade.pdf';

// Tempo de expiração do link (em segundos) – aqui 2 horas
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 2;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { email, orderId } = req.query || {};

    // ✅ agora é realmente obrigatório
    if (!email || !orderId) {
      return res.status(400).json({
        step: 'validation',
        error: 'E-mail e orderId são obrigatórios para liberar o download.',
      });
    }

    const emailClean = String(email).trim();
    const orderIdClean = String(orderId).trim();

    log('🔍 [/api/download] Buscando pedido para:', {
      email: emailClean,
      orderId: orderIdClean,
    });

    // ✅ busca direta: id + email (sem fallback, sem order)
    const { data, error } = await supabaseAdmin
      .from('ebook_order')
      .select('id, status, download_allowed, mp_status, email')
      .eq('id', orderIdClean)
      .ilike('email', emailClean)
      .limit(1);

    if (error) {
      logError(
        '❌ Erro Supabase ao buscar pedido em /api/download:',
        JSON.stringify(error, null, 2)
      );

      return res.status(500).json({
        step: 'supabase-select',
        error: 'Erro ao buscar pedido no Supabase.',
        details: error.message || error,
      });
    }

    if (!data || data.length === 0) {
      warn('⚠ Nenhum pedido encontrado para este e-mail + orderId.', {
        email: emailClean,
        orderId: orderIdClean,
      });

      return res.status(404).json({
        found: false,
        allowed: false,
        error: 'Nenhum pedido encontrado para este e-mail.',
      });
    }

    const order = data[0];

    log('📦 Pedido encontrado em /api/download:', {
      id: order.id,
      status: order.status,
      download_allowed: order.download_allowed,
      mp_status: order.mp_status,
    });

    // 2) Se ainda não liberou download, apenas informa status
    if (!order.download_allowed) {
      log('⏳ Download ainda não liberado para este pedido:', {
        id: order.id,
        status: order.status,
        mp_status: order.mp_status,
      });

      return res.status(200).json({
        found: true,
        allowed: false,
        status: order.status,
        mpStatus: order.mp_status,
        orderId: order.id,
        message:
          'Seu pagamento ainda não foi confirmado. Assim que for aprovado, o download será liberado automaticamente.',
      });
    }

    // 3) Gera URL assinada do PDF principal
    log('🔐 Gerando signed URL para o e-book:', {
      bucket: EBOOK_BUCKET,
      path: EBOOK_MAIN_PATH,
    });

    const { data: ebookSigned, error: ebookSignedError } =
      await supabaseAdmin.storage
        .from(EBOOK_BUCKET)
        .createSignedUrl(EBOOK_MAIN_PATH, SIGNED_URL_EXPIRES_IN);

    if (ebookSignedError) {
      logError(
        '❌ Erro ao criar signed URL do e-book principal:',
        JSON.stringify(ebookSignedError, null, 2)
      );

      return res.status(500).json({
        step: 'signed-url-ebook',
        error: 'Erro ao gerar link de download do e-book.',
        details: ebookSignedError.message || ebookSignedError,
      });
    }

    const ebookUrl = ebookSigned?.signedUrl;

    if (!ebookUrl) {
      logError(
        '❌ Signed URL do e-book veio vazio em /api/download:',
        JSON.stringify(ebookSigned, null, 2)
      );

      return res.status(500).json({
        step: 'signed-url-empty',
        error: 'Não foi possível gerar o link de download do e-book.',
      });
    }

    log('✅ Signed URL gerada com sucesso.');

    // 4) Retorna dados para o front
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
    logError('🔥 Erro inesperado em /api/download:', err);

    return res.status(500).json({
      step: 'unknown',
      error: 'Erro interno ao gerar link de download.',
      details: err?.message || String(err),
    });
  }
}
