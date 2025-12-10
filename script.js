// ---------------------------------------------------------
// 🔎 Detecta bloqueio de scripts do Mercado Pago (AdBlock)
// ---------------------------------------------------------
async function detectarBloqueioMP() {
  const url = "https://sdk.mercadopago.com/js/v2";

  try {
    const resp = await fetch(url, { method: "HEAD" });
    return !resp.ok; // se não carregar → bloqueado
  } catch (e) {
    return true; // erro = bloqueado
  }
}

// ---------------------------------------------------------
// 🔎 Exibe alerta se o navegador estiver bloqueando o checkout
// ---------------------------------------------------------
async function verificarBloqueioMP() {
  const bloqueado = await detectarBloqueioMP();

  if (bloqueado) {
    alert(
      "⚠ Atenção!\n\nSeu navegador pode estar bloqueando scripts do Mercado Pago. " +
        "Isso pode desabilitar o botão 'Pagar'.\n\n" +
        "Soluções rápidas:\n" +
        "• Abra esta página em modo anônimo;\n" +
        "• Desative AdBlock / bloqueadores;\n" +
        "• Permita cookies e scripts de terceiros."
    );
  }
}

// ---------------------------------------------------------
// 💳 Fluxo de checkout: modal + chamada para /api/create-checkout
// ---------------------------------------------------------
function iniciarCheckout() {
  // Botões
  const payPixBtn = document.getElementById("pay-pix");
  const payPixSecondaryBtn = document.getElementById("pay-pix-secondary");
  const payCardBtn = document.getElementById("pay-card");
  const payCardFinalBtn = document.getElementById("pay-card-final");

  // Modal
  const modal = document.getElementById("checkout-modal");
  const modalClose = document.getElementById("modal-close");
  const checkoutForm = document.getElementById("checkout-form");

  // Inputs
  const buyerNameInput = document.getElementById("buyer-name");
  const buyerEmailInput = document.getElementById("buyer-email");
  const modalMessage = document.getElementById("modal-message");

  // Botão de submit do formulário
  const submitBtn = checkoutForm
    ? checkoutForm.querySelector('button[type="submit"]')
    : null;

  let currentPaymentMethod = null;
  let isSubmitting = false; // trava contra clique duplo

  // Abre modal
  function openModal(method) {
    currentPaymentMethod = method;
    modal.classList.remove("hidden");
    modalMessage.textContent = "";
    checkoutForm.reset();
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Continuar para pagamento seguro";
    }
  }

  // Fecha modal
  function closeModal() {
    modal.classList.add("hidden");
  }

  // Botões → abre modal
  payPixBtn?.addEventListener("click", () => openModal("pix"));
  payPixSecondaryBtn?.addEventListener("click", () => openModal("pix"));
  payCardBtn?.addEventListener("click", () => openModal("card"));
  payCardFinalBtn?.addEventListener("click", () => openModal("card"));
  modalClose?.addEventListener("click", closeModal);

  // Fechar clicando fora
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // ----------------------------------------------
  // 🧠 Formulário → cria preferência no backend
  // ----------------------------------------------
  checkoutForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (isSubmitting) {
      // já está processando, ignora novo clique
      return;
    }

    const name = buyerNameInput.value.trim();
    const email = buyerEmailInput.value.trim();

    if (!name || !email) {
      modalMessage.textContent = "Preencha nome e e-mail para continuar.";
      return;
    }

    if (!currentPaymentMethod) {
      modalMessage.textContent = "Escolha primeiro uma forma de pagamento.";
      return;
    }

    isSubmitting = true;
    modalMessage.textContent = "Iniciando pagamento seguro...";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Processando...";
    }

    try {
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          paymentMethod: currentPaymentMethod, // "pix" ou "card"
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("Erro:", result);
        modalMessage.textContent =
          result.error ||
          "Erro ao iniciar o pagamento. Tente novamente em alguns instantes.";
        isSubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Continuar para pagamento seguro";
        }
        return;
      }

      // Guarda e-mail para página obrigado.html (se quiser usar no futuro)
      try {
        localStorage.setItem("buyer_email", email);
      } catch {}

      if (!result.initPoint) {
        modalMessage.textContent =
          "Erro inesperado ao gerar pagamento. Tente novamente.";
        isSubmitting = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Continuar para pagamento seguro";
        }
        return;
      }

      // Redireciona para checkout do Mercado Pago
      window.location.href = result.initPoint;
    } catch (err) {
      console.error(err);
      modalMessage.textContent =
        "Falha ao conectar. Verifique sua internet e tente novamente.";
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Continuar para pagamento seguro";
      }
    }
  });
}

// ---------------------------------------------------------
// 🚀 Inicialização automática ao carregar a página
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  verificarBloqueioMP();
  iniciarCheckout();
});
