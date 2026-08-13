const { invoke } = window.__TAURI__.core;

const list = document.querySelector("#profile-list");
const form = document.querySelector("#create-form");
const input = document.querySelector("#profile-name");
const refreshButton = document.querySelector("#refresh-button");
const message = document.querySelector("#message");

let messageTimer;
let busy = false;
let renderedProfilesSignature = null;

function showMessage(text, isError = false) {
  window.clearTimeout(messageTimer);
  message.textContent = text;
  message.classList.toggle("error", isError);
  message.hidden = false;
  messageTimer = window.setTimeout(() => {
    message.hidden = true;
  }, 4200);
}

function errorText(error) {
  return typeof error === "string" ? error : "操作を完了できませんでした";
}

function createButton(label, className, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function profileSignature(profiles) {
  return JSON.stringify(profiles);
}

function renderProfiles(profiles, { animate = true } = {}) {
  renderedProfilesSignature = profileSignature(profiles);
  list.replaceChildren();
  profiles.forEach((profile, index) => {
    const row = document.createElement("article");
    row.className = "profile-row";
    if (animate) {
      row.style.animationDelay = `${index * 28}ms`;
    } else {
      row.style.animation = "none";
    }

    const identity = document.createElement("div");
    identity.className = "profile-identity";
    const name = document.createElement("p");
    name.className = "profile-name";
    name.textContent = profile.name;
    const kind = document.createElement("p");
    kind.className = "profile-kind";
    kind.textContent = profile.isDefault ? "既存のChatGPT環境" : "分離プロファイル";
    identity.append(name, kind);

    const status = document.createElement("span");
    status.className = `status${profile.running ? " running" : ""}`;
    status.textContent = profile.running ? "起動中" : "停止中";

    const actions = document.createElement("div");
    actions.className = "actions";
    const launchLabel = profile.running ? "前面に表示" : "起動";
    actions.append(
      createButton(launchLabel, "action", () => runProfileAction("launch_profile", profile.name)),
    );
    if (profile.running) {
      actions.append(
        createButton("終了", "action stop", () => runProfileAction("stop_profile", profile.name)),
      );
    }
    row.append(identity, status, actions);
    list.append(row);
  });
}

async function loadProfiles({ quiet = false } = {}) {
  if (busy) return;
  if (!quiet && renderedProfilesSignature === null) {
    list.innerHTML = '<p class="loading">読み込み中...</p>';
  }
  try {
    const profiles = await invoke("list_profiles");
    const nextSignature = profileSignature(profiles);
    if (nextSignature !== renderedProfilesSignature) {
      renderProfiles(profiles, { animate: renderedProfilesSignature === null });
    }
  } catch (error) {
    renderedProfilesSignature = null;
    list.innerHTML = '<p class="empty">プロファイルを読み込めませんでした。</p>';
    showMessage(errorText(error), true);
  }
}

async function runProfileAction(command, name) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    await invoke(command, { name });
    window.setTimeout(() => loadProfiles({ quiet: true }), command === "launch_profile" ? 1300 : 500);
  } catch (error) {
    showMessage(errorText(error), true);
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const submit = form.querySelector("button");
  submit.disabled = true;
  try {
    const profiles = await invoke("create_profile", { name: input.value });
    input.value = "";
    renderProfiles(profiles);
    showMessage("プロファイルを追加しました");
  } catch (error) {
    showMessage(errorText(error), true);
  } finally {
    busy = false;
    submit.disabled = false;
    input.focus();
  }
});

refreshButton.addEventListener("click", () => loadProfiles());
window.setInterval(() => loadProfiles({ quiet: true }), 4000);
loadProfiles();
