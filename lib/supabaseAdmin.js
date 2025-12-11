// /lib/supabaseAdmin.js
import { createClient } from '@supabase/supabase-js';

// ✅ Variáveis de ambiente (NUNCA hardcode!)
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Avisos básicos em caso de configuração errada
if (!supabaseUrl) {
  console.error('❌ SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL não configurada!');
}

if (!supabaseServiceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY não configurada!');
}

/**
 * Cliente "admin" do Supabase
 *
 * - Usa SERVICE ROLE KEY → acesso completo ao banco (RLS ignorado).
 * - Só deve ser usado em código do servidor (API Routes, server actions, etc.).
 * - Nunca expor essa chave no front.
 */

// Evita recriar o client em dev (hot reload do Next)
let _supabaseAdmin = globalThis._supabaseAdmin || null;

if (!_supabaseAdmin) {
  // Falta de configuração: em produção, quebra cedo; em dev, só loga e mantém null
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const msg =
      'Supabase admin mal configurado: verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.';

    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    } else {
      console.warn('⚠️ ' + msg);
    }
  } else {
    // Cria client admin
    _supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Salva no escopo global em ambiente de desenvolvimento
    if (process.env.NODE_ENV !== 'production') {
      globalThis._supabaseAdmin = _supabaseAdmin;
    }
  }
}

export const supabaseAdmin = _supabaseAdmin;
