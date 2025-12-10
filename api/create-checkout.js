// /api/create-checkout.js
import mercadopago from 'mercadopago';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// ⚙️ Credenciais
const accessToken = process.env.MP_ACCESS_TOKEN;
const notificationUrl = process.env.MP_NOTIFICATION_URL;

if (!accessToken) {
  console.error('MP_ACCESS_TOKEN não configurado na Vercel!');
} else {
  mercadopago.configure({
    access_token: accessToken,
  });
}

export default async function handler(req, res) {
  // Só aceita POST – GET na URL mostra "Método não permitido" (está certo)
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

    // 'pix' ou 'card' – se vier qualquer outra coisa, força 'card'
    const method = paymentMethod === 'pix' ? 'pix' : 'card';
    const isPix = method === 'pix';

    // 1) CRIA LINHA NO SUPABASE (ebook_order)
    const { data: order, error: supaInsertError } = await supabaseAdmin
      .from('ebook_order')
      .insert({
        name,
        email,
        status: 'pending', // texto interno
        download_allowed: false,
        mp_status: 'init', // status inicial do MP
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

    const orderId = order.id; // uuid gerado pelo Supabase

    // 2) MONTA PREFERENCE DO MERCADO PAGO

    // Configuração específica de pagamento
    const paymentMethods = isPix
      ? {
          // Foco em PIX
          default_payment_method_id: 'pix',
          excluded_payment_types: [
            {
              id: 'ticket',
            }, // tira boleto
          ],
        }
      : {
          // Foco em cartão – remove Pix
          excluded_payment_types: [
            {
              id: 'ticket',
            },
          ],
          excluded_payment_methods: [
            {
              id: 'pix',
            },
          ],
        };

    const preferenceData = {
      external_reference: orderId, // casa com a coluna id da tabela
      auto_return: 'approved',
      back_urls: {
        // 👉 Agora tudo volta para a página de download
        success: 'https://octopusaxisebook.com/download.html',
        pending: 'https://octopusaxisebook.com/download.html',
        failure: 'https://octopusaxisebook.com/download.html',
      },
      items: [
        {
          id: 'ebook-musica-ansiedade',
          title: 'E-book Música & Ansiedade',
          description: 'E-book da série Música & Medicina',
          quantity: 1,
          unit_price: 129, // valor em R$
          currency_id: 'BRL',
          category_id: 'ebooks',
        },
      ],
      payer: {
        name,
        email,
      },
      // Webhook que atualiza status / download_allowed no Supabase
      notification_url: notificationUrl || undefined,
      payment_methods: paymentMethods,
    };

    // 3) CRIA PREFERENCE NO MERCADO PAGO
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
        error:
          'Resposta inesperada do Mercado Pago ao criar preferência. Verificar logs.',
      });
    }

    // 4) ATUALIZA LINHA NO SUPABASE COM DADOS DA PREFERENCE
    const { error: supaUpdateError } = await supabaseAdmin
      .from('ebook_order')
      .update({
        mp_external_reference: String(orderId), // redundante, mas útil p/ debug
        mp_raw: preference.body, // jsonb
      })
      .eq('id', orderId);

    if (supaUpdateError) {
      console.error(
        'Erro ao atualizar pedido com dados da preferência:',
        JSON.stringify(supaUpdateError, null, 2)
      );
      // não bloqueia o fluxo – só loga
    }

    // 5) RESPONDE PARA O FRONT
    return res.status(200).json({
      initPoint, // usado pelo script.js para redirecionar
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
