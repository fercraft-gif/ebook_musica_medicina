// /api/download.js
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

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
const EBOOK_MAIN_PATH =
  process.env.EBOOK_MAIN_PATH || 'musica-e-ansiedade.pdf';

// Tempo de expiração do link (em segundos) – aqui 2 horas
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 2;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { email, orderId } = req.query || {};

    if (!email) {
      return res.status(400).json({
        step: 'validation',
        error: 'E-mail é obrigatório para localizar seu pedido.',
      });
    }

    const emailClean = String(email).trim();

    console.log('🔍 [/api/download] Buscando pedido para:', {
      email: emailClean,
      orderId: orderId || null,
    });

    // 1) Busca o pedido do usuário (ou um específico, se orderId vier)
    let query = supabaseAdmin
      .from('ebook_order')
      .select('id, status, download_allowed, mp_status, email')
      // ilike deixa a busca de e-mail case-insensitive (Nanda / nanda)
      .ilike('email', emailClean);

    if (orderId) {
      query = query.eq('id', String(orderId).trim());
    }

    // como não temos created_at, ordena pelo id para pegar o mais "recente"
    query = query.order('id', { ascending: false }).limit(1);

    const { data, error } = await query;

    if (error) {
      console.error(
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
      console.warn('⚠ Nenhum pedido encontrado para este e-mail.', {
        email: emailClean,
      });

      return res.status(404).json({
        found: false,
        allowed: false,
        error: 'Nenhum pedido encontrado para este e-mail.',
      });
    }

    const order = data[0];

    console.log('📦 Pedido encontrado em /api/download:', order);

    // 2) Se ainda não liberou download, apenas informa status
    if (!order.download_allowed) {
      console.log('⏳ Download ainda não liberado para este pedido:', {
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
    console.log('🔐 Gerando signed URL para o e-book:', {
      bucket: EBOOK_BUCKET,
      path: EBOOK_MAIN_PATH,
    });

    const { data: ebookSigned, error: ebookSignedError } =
      await supabaseAdmin.storage
        .from(EBOOK_BUCKET)
        .createSignedUrl(EBOOK_MAIN_PATH, SIGNED_URL_EXPIRES_IN);

    if (ebookSignedError) {
      console.error(
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
      console.error(
        '❌ Signed URL do e-book veio vazio em /api/download:',
        JSON.stringify(ebookSigned, null, 2)
      );

      return res.status(500).json({
        step: 'signed-url-empty',
        error: 'Não foi possível gerar o link de download do e-book.',
      });
    }

    console.log('✅ Signed URL gerada com sucesso.');

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
    console.error('🔥 Erro inesperado em /api/download:', err);

    return res.status(500).json({
      step: 'unknown',
      error: 'Erro interno ao gerar link de download.',
      details: err?.message || String(err),
    });
  }
}
