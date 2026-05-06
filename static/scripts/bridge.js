/**
 * DeadSouls | Bridge Core
 * Фоновый поток для проверки связи с локальным агентом.
 */

const BC_STORAGE_CONNECTED = "bridge_connected_session";
const BC_LS_HOST = "ds_bridge_host";
const BC_LS_PORT = "ds_bridge_port";
const BC_LS_STATUS_PATH = "ds_bridge_status_path";
const BC_POLL_MS = 1000;

const bridgeState = {
  timer: null,
  handled: sessionStorage.getItem(BC_STORAGE_CONNECTED) === "1",
};

function getBridgeBaseUrl() {
  const host = localStorage.getItem(BC_LS_HOST) || "127.0.0.1";
  const port = localStorage.getItem(BC_LS_PORT) || "3847";
  return `http://${host}:${port}`;
}

async function pollBridge() {
  const base = getBridgeBaseUrl();
  const path = localStorage.getItem(BC_LS_STATUS_PATH) || "/bridge/status";
  const url = base + (path.startsWith("/") ? path : "/" + path);

  try {
    const res = await fetch(url, { 
        method: "GET", 
        headers: { Accept: "application/json" },
        cache: "no-store" 
    });
    
    const data = await res.json().catch(() => null);

    if (res.ok && (data?.bridgeReady || data?.injected || ["ready", "ok"].includes(data?.status))) {
      updateBridgeUi("ok");
      
      if (!bridgeState.handled) {
        bridgeState.handled = true;
        sessionStorage.setItem(BC_STORAGE_CONNECTED, "1");
        executeSuccessAction();
      }
      return;
    }
    updateBridgeUi("pooling");
  } catch {
    updateBridgeUi("pooling");
  }
}

function updateBridgeUi(status) {
  const row = document.getElementById("poll-status");
  if (!row) return;

  const textEl = row.querySelector(".poll-status-text");
  const openPanelBtn = document.getElementById("btn-open-panel");

  if (status === "ok") {
    if (textEl) textEl.textContent = window.t('bridge_ok');
    if (openPanelBtn) {
      openPanelBtn.disabled = false;
      openPanelBtn.onclick = () => window.location.href = "panel";
    }
  } else {
    if (textEl) textEl.textContent = window.t('bridge_pooling');
    if (openPanelBtn) openPanelBtn.disabled = true;
  }
}

function executeSuccessAction() {
  document.body.classList.add("state-blur", "state-success-tint");
  const overlay = document.getElementById("success-overlay");
  if (overlay) overlay.hidden = false;

  setTimeout(() => {
    window.location.href = "/panel";
  }, 2200);
}

if (sessionStorage.getItem(BC_STORAGE_CONNECTED) !== "1") {
    bridgeState.timer = setInterval(pollBridge, BC_POLL_MS);
    pollBridge();
} else {
    updateBridgeUi("ok");
}