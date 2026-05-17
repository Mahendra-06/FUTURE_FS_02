const leadForm = document.querySelector("#leadForm");
const leadFormMessage = document.querySelector("#leadFormMessage");
const leadAuthBadge = document.querySelector("#leadAuthBadge");
const leadLoginNotice = document.querySelector("#leadLoginNotice");
const leadSubmitButton = document.querySelector("#leadSubmitButton");
const publicGuestActions = document.querySelector("#publicGuestActions");
const publicUserActions = document.querySelector("#publicUserActions");
const publicUserChip = document.querySelector("#publicUserChip");
const publicDashboardLink = document.querySelector("#publicDashboardLink");
const publicLogoutButton = document.querySelector("#publicLogoutButton");

let signedInUser = null;

async function checkLeadFormAuth() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();
    signedInUser = data.user;
  } catch {
    signedInUser = null;
  }

  const isSignedIn = Boolean(signedInUser);
  publicGuestActions.classList.toggle("hidden", isSignedIn);
  publicUserActions.classList.toggle("hidden", !isSignedIn);

  if (isSignedIn) {
    publicUserChip.textContent = `${signedInUser.name} / ${title(signedInUser.role)}`;
    publicDashboardLink.href = signedInUser.role === "customer" ? "/portal" : "/admin";
    publicDashboardLink.textContent = signedInUser.role === "customer" ? "My requests" : "Dashboard";
    publicDashboardLink.classList.remove("hidden");
    const nameInput = leadForm.elements.name;
    const emailInput = leadForm.elements.email;
    if (!nameInput.value) nameInput.value = signedInUser.name;
    if (!emailInput.value) emailInput.value = signedInUser.email;
  }

  leadAuthBadge.textContent = isSignedIn ? `Signed in as ${signedInUser.name}` : "Login required";
  leadLoginNotice.classList.toggle("hidden", isSignedIn);
  leadSubmitButton.disabled = !isSignedIn;
  leadForm.querySelectorAll("input, select, textarea").forEach((field) => {
    field.disabled = !isSignedIn;
  });
  leadFormMessage.textContent = isSignedIn ? "" : "Sign in to submit this consultation request.";
  leadFormMessage.classList.toggle("error", !isSignedIn);
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

leadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!signedInUser) {
    leadFormMessage.textContent = "Please login before submitting the consultation request.";
    leadFormMessage.classList.add("error");
    return;
  }

  leadFormMessage.textContent = "Submitting lead...";
  leadFormMessage.classList.remove("error");

  try {
    const response = await fetch("/api/public/leads", {
      method: "POST",
      body: new FormData(leadForm)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not submit lead.");

    leadForm.reset();
    leadFormMessage.textContent = "Lead saved. The admin dashboard is ready for follow-up.";
  } catch (error) {
    leadFormMessage.textContent = error.message;
    leadFormMessage.classList.add("error");
  }
});

publicLogoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
  signedInUser = null;
  leadForm.reset();
  await checkLeadFormAuth();
});

checkLeadFormAuth();
