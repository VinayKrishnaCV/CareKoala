const get = (id) => document.getElementById(id);
window.lockdown.status((s) => {
  get("delivery").textContent = s.message;
  get("remote").textContent = s.remote || "";
  get("reason").textContent = s.test
    ? "DEMO — no real concern was detected."
    : "CareKoala detected content with a score of 8 or higher. Please check in with your guardian.";
});

window.lockdown.guardianUnlocked(() => {
  get("key").value = "•".repeat(32);
  for (const el of [...get("unlock").elements, get("resend")])
    el.disabled = true;
  get("remote").textContent = "";
  get("delivery").textContent = "";
  get("result").classList.add("ok");
  get("result").textContent = "Your guardian sent the unlock key. Unlocking…";
});
get("unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  const result = await window.lockdown.unlock(get("key").value.trim());
  get("key").value = "";
  get("result").textContent = result.ok ? "Unlocked" : result.error;
});
get("resend").addEventListener("click", async () => {
  get("resend").disabled = true;
  try {
    const result = await window.lockdown.resend();
    if (!result.ok) get("result").textContent = result.error;
  } finally {
    get("resend").disabled = false;
  }
});
