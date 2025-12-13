// /script.js
(function () {
  // ==========================
  // Config
  // ==========================
  const API_CHECKOUT_URL = "/api/create-checkout";

  // ==========================
  // Util
  // ==========================
  function $(id) {
    return document.getElementById(id);
  }

function getFormData() {
  // tenta por IDs conhecidos
  const nameEl =
    document.getElementById("name") ||
    document.getElementById("buyer-name") ||
    document.getElementById("customer-name");

  const emailEl =
    document.getElementById("email") ||
    document.getElementById("buyer-email") ||
    document.getElementById("customer-email");

  // fallback: tenta achar qualquer input de email visível
  const emailFallback =
    emailEl ||
    document.querySelector('input[type="email"]') ||
    document.querySelector('input[name="email"]') ||
    document.querySelector('input[autocomplete="email"]');

  // fallback: tenta achar qualquer input de nome visível
  const nameFallback =
    nameEl ||
    document.querySelector('input[name="name"]') ||
    document.querySelector('input[autocomplete="name"]') ||
    document.querySelector('input[type="text"]');

  let name = (nameFallback?.value || "").trim();
  let email = (emailFallback?.value || "").trim();

  // fallback: se a página não tem inputs visíveis, pergunta via prompt
  if (!name) name = (prompt("Digite seu nome para continuar:") || "").trim();
  if (!email)
    email = (prompt("Digite seu e-mail para receber o download:") || "").trim();

  return { name, email };
}

function ensureNameEmail({ name, email }) {
  if (!name || !email) {
    alert("Por favor, preencha nome e e-mail para continuar.");
    return false;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    alert("E-mail inválido. Confira e tente novamente.");
    return false;
  }
  return true;
}

  // ==========================
  // AdBlock / bloqueio MP (não quebra fluxo)
  // ==========================
  async function detectarBloqueioMP() {
    const url = "https://sdk.mercadopago.com/js/v2";
    try {
      const resp = await fetch(url, { method: "HEAD", mode: "no-cors" });
      // no-cors pode retornar "opaque"; nesse caso consideramos "não bloqueado"
      return false;
    } catch (e) {
      return true;
    }
  }

  async function verificarBloqueioMPUmaVez() {
    const key = "mp_block_warning_shown";
    if (sessionStorage.getItem(key) === "1") return;

    const bloqueado = await detectarBloqueioMP();
    if (bloqueado) {
      sessionStorage.setItem(key, "1");
      alert(
        "⚠ Atenção!\n\nSeu navegador pode estar bloqueando scripts do Mercado Pago.\n" +
          "Isso pode desabilitar o checkout.\n\n" +
          "Soluções rápidas:\n" +
          "• Abra em aba anônima\n" +
          "• Desative AdBlock/bloqueadores\n" +
          "• Permita cookies/scripts de terceiros"
      );
    }
  }

  // ==========================
  // Checkout
  // ==========================
  async function criarCheckout({ name, email, paymentMethod }) {
    const resp = await fetch(API_CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, paymentMethod }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("Erro /api/create-checkout:", data);
      throw new Error(data?.error || "Falha ao iniciar checkout.");
    }

    return data;
  }

function abrirCheckout(initPoint, popupRef) {
  // Se abriu aba no clique, redireciona ela
  if (popupRef && !popupRef.closed) {
    try {
      popupRef.location.replace(initPoint);
      return;
    } catch (e) {
      // cai no fallback
    }
  }

  // Fallback: mesma aba (não tem bloqueio)
  window.location.href = initPoint;
}

async function iniciarCheckout(paymentMethod) {
  await verificarBloqueioMPUmaVez();

  const form = getFormData();
  if (!ensureNameEmail(form)) return;

  // ✅ Abre no clique (placeholder)
  const popupRef = window.open("", "_blank"); // <-- sem noopener/noreferrer aqui

  // Se abriu, mostra texto pra não ficar branco
  if (popupRef && !popupRef.closed) {
    try {
      popupRef.document.title = "Abrindo checkout…";
      popupRef.document.body.innerHTML =
        "<p style='font-family:Inter,Arial;padding:16px'>Abrindo checkout do Mercado Pago…</p>";
    } catch {}
  }

  try {
    setButtonsDisabled(true);

    const data = await criarCheckout({ ...form, paymentMethod });

    if (!data?.initPoint) {
      throw new Error("API não retornou initPoint. Verifique /api/create-checkout.");
    }

    // ✅ redireciona a aba aberta OU usa fallback na mesma aba
    abrirCheckout(data.initPoint, popupRef);
  } catch (err) {
    // fecha a aba vazia se der ruim
    if (popupRef && !popupRef.closed) {
      try { popupRef.close(); } catch {}
    }
    console.error(err);
    alert(err?.message || "Erro ao iniciar pagamento. Tente novamente.");
  } finally {
    setButtonsDisabled(false);
  }
}
  // ==========================
  // Bind
  // ==========================
  function bind() {
    const payPixBtn = $("pay-pix");
    const payPixSecondaryBtn = $("pay-pix-secondary");
    const payCardBtn = $("pay-card");
    const payCardFinalBtn = $("pay-card-final");

    // não explode se não existir
    payPixBtn?.addEventListener("click", () => iniciarCheckout("pix"));
    payPixSecondaryBtn?.addEventListener("click", () => iniciarCheckout("pix"));
    payCardBtn?.addEventListener("click", () => iniciarCheckout("card"));
    payCardFinalBtn?.addEventListener("click", () => iniciarCheckout("card"));

    console.log("script.js carregado ✅");
  }

  // init
  document.addEventListener("DOMContentLoaded", bind);
})();
