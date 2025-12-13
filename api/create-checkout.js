// /api/create-checkout.js
import mercadopago from 'mercadopago';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// ⚙️ Credenciais
const accessToken = process.env.MP_ACCESS_TOKEN;
const notificationUrl = process.env.MP_NOTIFICATION_URL;

if (!accessToken) {
  console.error('MP_ACCESS_TOKEN não configurado na Vercel!');
} else {
  mercadopago.configure({ access_token: accessToken });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { name, email, paymentMethod } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        step: 'validation',
        error: 'Nome e e-mail são obrigatórios.',
      });
    }

    const method = paymentMethod === 'pix' ? 'pix' : 'card';
    const isPix = method === 'pix';

    // 🔗 URL base da página de download (NUNCA liberar só com email)
    const baseDownloadUrl = 'https://octopusaxisebook.com/download.html';
    const homeUrl = 'https://octopusaxisebook.com';

    // ---------------------------------------------------------
    // 0) Anti-duplicação por e-mail
    // ---------------------------------------------------------

    // A) Se já comprou (download liberado), não cria checkout de novo
    const { data: alreadyRows, error: alreadyErr } = await supabaseAdmin
      .from('ebook_order')
      .select('id')
      .eq('email', email)
      .eq('download_allowed', true)
      .order('id', { ascending: false })
      .limit(1);

    if (alreadyErr) {
      console.error('Erro Supabase ao checar alreadyPurchased:', alreadyErr);
      return res.status(500).json({
        step: 'supabase-check-already',
        error: 'Erro ao verificar compra existente.',
      });
    }

    if (alreadyRows && alreadyRows.length > 0) {
      const paidOrderId = alreadyRows[0].id;

      return res.status(200).json({
        alreadyPurchased: true,
        redirectTo:
          baseDownloadUrl +
          '?email=' +
          encodeURIComponent(email) +
          '&orderId=' +
          encodeURIComponent(String(paidOrderId)),
      });
    }

    // B) Se já existe pending para esse e-mail, reutiliza o pedido (evita duplicar)
    const { data: pendingRows, error: pendingErr } = await supabaseAdmin
      .from('ebook_order')
      .select('id')
      .eq('email', email)
      .eq('download_allowed', false)
      .eq('status', 'pending')
      .order('id', { ascending: false })
      .limit(1);

    if (pendingErr) {
      console.error('Erro Supabase ao checar pending existente:', pendingErr);
      return res.status(500).json({
        step: 'supabase-check-pending',
        error: 'Erro ao verificar pedido pendente existente.',
      });
    }

    let orderId;

    if (pendingRows && pendingRows.length > 0) {
      orderId = pendingRows[0].id;
    } else {
      // 1) CRIA LINHA NO SUPABASE (ebook_order) só quando não existe pending
      const { data: order, error: supaInsertError } = await supabaseAdmin
        .from('ebook_order')
        .insert({
          name,
          email,
          status: 'pending',
          download_allowed: false,
          mp_status: 'init',
        })
        .select('id')
        .single();

      if (supaInsertError) {
        console.error(
          'Erro Supabase ao inserir pedido:',
          JSON.stringify(supaInsertError, null, 2)
        );

        return res.status(500).json({
          step: 'supabase-insert',
          error: 'Erro ao registrar pedido no Supabase.',
          details: supaInsertError.message || supaInsertError,
        });
      }

      orderId = order.id;
    }

    // ✅ Download URL SEMPRE com orderId (nunca só email)
    const downloadUrl =
      baseDownloadUrl +
      '?email=' +
      encodeURIComponent(email) +
      '&orderId=' +
      encodeURIComponent(String(orderId));

    // ---------------------------------------------------------
    // 2) MONTA PREFERENCE DO MERCADO PAGO
    // ---------------------------------------------------------
    const paymentMethods = isPix
      ? {
          default_payment_method_id: 'pix',
          excluded_payment_types: [{ id: 'ticket' }], // tira boleto
        }
      : {
          excluded_payment_types: [{ id: 'ticket' }],
          excluded_payment_methods: [{ id: 'pix' }], // remove pix no cartão
        };

    const preferenceData = {
      external_reference: String(orderId), // casa com a coluna id da tabela
      auto_return: 'approved',
      back_urls: {
        success: downloadUrl,
        pending: downloadUrl,
        // não manda para download em failure
        failure: homeUrl + '?pay=failure',
      },
      items: [
        {
          id: 'ebook-musica-ansiedade',
          title: 'E-book Música & Ansiedade',
          description: 'E-book da série Música & Medicina',
          quantity: 1,
          unit_price: 129,
          currency_id: 'BRL',
          category_id: 'ebooks',
        },
      ],
      payer: { name, email },
      notification_url: notificationUrl || undefined,
      payment_methods: paymentMethods,
    };

    // ---------------------------------------------------------
    // 3) CRIA PREFERENCE NO MERCADO PAGO
    // ---------------------------------------------------------
    let preference;
    try {
      preference = await mercadopago.preferences.create(preferenceData);
    } catch (mpErr) {
      if (mpErr?.response) {
        console.error(
          'Erro Mercado Pago (preferences.create): status',
          mpErr.response.status,
          'body',
          JSON.stringify(mpErr.response.body, null, 2)
        );
      } else {
        console.error('Erro Mercado Pago (preferences.create):', mpErr);
      }

      return res.status(500).json({
        step: 'mp-preference',
        error: 'Erro ao criar preferência no Mercado Pago.',
        details: mpErr?.response?.body || mpErr?.message || String(mpErr),
      });
    }

    const initPoint = preference?.body?.init_point;
    const prefId = preference?.body?.id;

    if (!initPoint || !prefId) {
      console.error(
        'Resposta inesperada do Mercado Pago:',
        JSON.stringify(preference?.body || preference, null, 2)
      );
      return res.status(500).json({
        step: 'mp-preference',
        error: 'Resposta inesperada do Mercado Pago ao criar preferência.',
      });
    }

    // ---------------------------------------------------------
    // 4) Atualiza pedido com dados da preference (debug)
    // ---------------------------------------------------------
    const { error: supaUpdateError } = await supabaseAdmin
      .from('ebook_order')
      .update({
        mp_external_reference: String(orderId),
        mp_preference_id: String(prefId), // mantenha só se a coluna existir
        mp_raw: preference.body,
      })
      .eq('id', orderId);

    if (supaUpdateError) {
      console.error(
        'Erro ao atualizar pedido com dados da preferência:',
        JSON.stringify(supaUpdateError, null, 2)
      );
      // não bloqueia o fluxo
    }

    // ---------------------------------------------------------
    // 5) RESPONDE PARA O FRONT
    // ---------------------------------------------------------
    return res.status(200).json({
      initPoint,
      preferenceId: prefId,
      orderId,
      name,
      email,
      method,
    });
  } catch (err) {
    console.error('Erro interno em /api/create-checkout:', err);

    return res.status(500).json({
      step: 'unknown',
      error: 'Erro interno ao criar checkout.',
      details: err?.message || String(err),
    });
  }
}
