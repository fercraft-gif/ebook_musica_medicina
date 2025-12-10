// /api/download.js
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

/**
 * download
 *
 * - Confere no Supabase se o pedido está com download_allowed = true
 * - Se estiver liberado, gera URL assinada do PDF (e opcionalmente bônus)
 * - Retorna as URLs em JSON para o front redirecionar ou abrir em nova aba
 *
 * Sugestão de uso no front (obrigado.html):
 *   fetch(`/api/download?email=${encodeURIComponent(email)}&orderId=${orderId}`)
 *     .then(r => r.json())
 *     .then(data => {
 *       if (data.allowed && data.ebookUrl) {
 *         window.location.href = data.ebookUrl;
 *       } else {
 *         // mostrar mensagem de "pagamento ainda em análise" etc.
 *       }
 *     });
 */

// Ajuste estes valores conforme o que você criou no Supabase Storage
const EBOOK_BUCKET = process.env.EBOOK_BUCKET || 'ebooks';
const EBOOK_MAIN_PATH =
  process.env.EBOOK_MAIN_PATH || 'musica-ansiedade/ebook-musica-ansiedade.pdf';
// Se não tiver bônus ainda, pode deixar como null
const EBOOK_BONUS_PATH =
  process.env.EBOOK_BONUS_PATH || null;

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
        error: 'E-mail é obrigatório para gerar o download.',
      });
    }

    // 1) Busca o pedido mais recente do usuário (ou um específico, se orderId vier)
    let query = supabaseAdmin
      .from('ebook_order')
      .select('id, status, download_allowed, mp_status, created_at')
      .eq('email', email);

    if (orderId) {
      query = query.eq('id', orderId);
    }

    query = query.order('created_at', { ascending: false }).limit(1);

    const { data, error } = await query;

    if (error) {
      console.error(
        'Erro Supabase ao buscar pedido em /api/download:',
        JSON.stringify(error, null, 2)
      );

      return res.status(500).json({
        step: 'supabase-select',
        error: 'Erro ao buscar pedido no Supabase.',
        details: error.message || error,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        found: false,
        allowed: false,
        error: 'Nenhum pedido encontrado para este e-mail.',
      });
    }

    const order = data[0];

    if (!order.download_allowed) {
      // Pagamento ainda não aprovado / webhook não atualizou
      return res.status(200).json({
        found: true,
        allowed: false,
        status: order.status,
        mpStatus: order.mp_status,
        orderId: order.id,
        message:
          'Seu pagamento ainda não foi confirmado. Assim que for aprovado, o download será liberado.',
      });
    }

    // 2) Gera URL assinada do PDF principal
    const { data: ebookSigned, error: ebookSignedError } =
      await supabaseAdmin.storage
        .from(EBOOK_BUCKET)
        .createSignedUrl(EBOOK_MAIN_PATH, SIGNED_URL_EXPIRES_IN);

    if (ebookSignedError) {
      console.error(
        'Erro ao criar signed URL do e-book principal:',
        JSON.stringify(ebookSignedError, null, 2)
      );

      return res.status(500).json({
        step: 'signed-url-ebook',
        error: 'Erro ao gerar link de download do e-book.',
        details: ebookSignedError.message || ebookSignedError,
      });
    }

    const ebookUrl = ebookSigned?.signedUrl;

    // 3) (Opcional) Gera URL assinada do bônus, se configurado
    let bonusUrl = null;

    if (EBOOK_BONUS_PATH) {
      const { data: bonusSigned, error: bonusSignedError } =
        await supabaseAdmin.storage
          .from(EBOOK_BUCKET)
          .createSignedUrl(EBOOK_BONUS_PATH, SIGNED_URL_EXPIRES_IN);

      if (bonusSignedError) {
        console.error(
          'Erro ao criar signed URL do material bônus:',
          JSON.stringify(bonusSignedError, null, 2)
        );
        // Não bloqueia o fluxo – apenas não envia bonusUrl
      } else {
        bonusUrl = bonusSigned?.signedUrl || null;
      }
    }

    // 4) Retorna as URLs para o front
    return res.status(200).json({
      found: true,
      allowed: true,
      status: order.status,
      mpStatus: order.mp_status,
      orderId: order.id,
      ebookUrl,
      bonusUrl,
      expiresInSeconds: SIGNED_URL_EXPIRES_IN,
    });
  } catch (err) {
    console.error('Erro inesperado em /api/download:', err);

    return res.status(500).json({
      step: 'unknown',
      error: 'Erro interno ao gerar link de download.',
      details: err?.message || String(err),
    });
  }
}
