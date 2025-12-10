// /lib/supabaseAdmin.js
import { createClient } from '@supabase/supabase-js';

// ✅ Variáveis de ambiente (NUNCA hardcode!)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
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

// Evita recriar o client em dev (hot reload do NSext)
let _supabaseAdmin = global._supabaseAdmin || null;

if (!_supabaseAdmin && supabaseUrl && supabaseServiceRoleKey) {
  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // salva no escopo global em ambiente de desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    global._supabaseAdmin = _supabaseAdmin;
  }
}

export const supabaseAdmin = _supabaseAdmin;
