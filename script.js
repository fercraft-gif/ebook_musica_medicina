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
  // Se a aba já foi aberta no clique, só redireciona ela (não é bloqueado)
  if (popupRef && !popupRef.closed) {
    try {
      popupRef.location.href = initPoint;
      return;
    } catch (e) {
      // se der erro por qualquer motivo, cai no fallback abaixo
    }
  }

  // Fallback 100% confiável: abre na mesma aba (não depende de pop-up)
  window.location.href = initPoint;
}

 async function iniciarCheckout(paymentMethod) {
  await verificarBloqueioMPUmaVez();

  const form = getFormData();
  if (!ensureNameEmail(form)) return;

  // ✅ ABRE O POPUP IMEDIATAMENTE NO CLIQUE (antes de qualquer await)
  // Isso evita bloqueio do navegador.
  const popupRef = window.open("about:blank", "_blank", "noopener,noreferrer");

  // Se o navegador bloqueou mesmo assim, a gente segue e abre na mesma aba no final.
  if (popupRef) {
    try {
      popupRef.document.title = "Abrindo checkout…";
    } catch {}
  }

  try {
    setButtonsDisabled(true);

    const data = await criarCheckout({
      ...form,
      paymentMethod,
    });

    // Se já comprou, vai pro download (como estava)
    if (data?.alreadyPurchased && data?.redirectTo) {
      if (popupRef && !popupRef.closed) popupRef.close();
      window.location.href = data.redirectTo;
      return;
    }

    if (!data?.initPoint) throw new Error("Checkout sem initPoint. Verifique logs.");

    // ✅ Redireciona o popup (se existir) OU abre na mesma aba (fallback)
    abrirCheckout(data.initPoint, popupRef);
  } catch (err) {
    // Se deu erro, fecha a aba vazia (se abriu)
    if (popupRef && !popupRef.closed) {
      try { popupRef.close(); } catch {}
    }
    console.error(err);
    alert(err?.message || "Erro ao iniciar pagamento. Tente novamente.");
  } finally {
    setButtonsDisabled(false);
  }
}

  function setButtonsDisabled(disabled) {
    const ids = ["pay-pix", "pay-pix-secondary", "pay-card", "pay-card-final"];
    ids.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
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
