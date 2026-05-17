const showLoginTab = document.querySelector("#showLoginTab");
const showRegisterTab = document.querySelector("#showRegisterTab");
const customerLoginForm = document.querySelector("#customerLoginForm");
const customerRegisterForm = document.querySelector("#customerRegisterForm");
const authMessage = document.querySelector("#authMessage");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setMode(mode) {
  const isLogin = mode === "login";
  customerLoginForm.classList.toggle("hidden", !isLogin);
  customerRegisterForm.classList.toggle("hidden", isLogin);
  showLoginTab.classList.toggle("active", isLogin);
  showRegisterTab.classList.toggle("active", !isLogin);
  authMessage.textContent = "";
  authMessage.classList.remove("error");
}

async function continueToConsultation() {
  window.location.href = "/portal";
}

showLoginTab.addEventListener("click", () => setMode("login"));
showRegisterTab.addEventListener("click", () => setMode("register"));

customerLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "Checking your account...";
  authMessage.classList.remove("error");

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(customerLoginForm).entries()))
    });
    authMessage.textContent = "Logged in. Returning to consultation form...";
    continueToConsultation();
  } catch (error) {
    authMessage.textContent = error.message;
    authMessage.classList.add("error");
  }
});

customerRegisterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "Creating your account...";
  authMessage.classList.remove("error");

  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(customerRegisterForm).entries()))
    });
    authMessage.textContent = "Account created. Returning to consultation form...";
    continueToConsultation();
  } catch (error) {
    authMessage.textContent = error.message;
    authMessage.classList.add("error");
  }
});
