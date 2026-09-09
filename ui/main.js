import { applyTranslations, initI18n, t, toggleLocale } from "./i18n.js";

const { invoke } = window.__TAURI__.core;

const list = document.querySelector("#profile-list");
const form = document.querySelector("#create-form");
const input = document.querySelector("#profile-name");
const refreshButton = document.querySelector("#refresh-button");
const languageToggle = document.querySelector("#language-toggle");
const message = document.querySelector("#message");

let messageTimer;
let busy = false;
let renderedProfilesSignature = null;
let lastProfiles = null;
let i18nReady = false;
let pendingDeleteName = null;
let pendingDeleteButton = null;
let pendingDeleteTimer;

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
  if (error && typeof error === "object" && typeof error.code === "string") {
    return t(`error.${error.code}`, error.params ?? {});
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return t("message.operationFailed");
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

function clearPendingDelete() {
  window.clearTimeout(pendingDeleteTimer);
  if (pendingDeleteButton) {
    pendingDeleteButton.textContent = t("action.delete");
    pendingDeleteButton.classList.remove("confirm");
  }
  pendingDeleteName = null;
  pendingDeleteButton = null;
}

function handleDeleteClick(profile, button) {
  if (pendingDeleteName === profile.name) {
    clearPendingDelete();
    runProfileAction("delete_profile", profile.name, { successKey: "message.profileDeleted" });
    return;
  }
  clearPendingDelete();
  pendingDeleteName = profile.name;
  pendingDeleteButton = button;
  button.textContent = t("action.deleteConfirm");
  button.classList.add("confirm");
  pendingDeleteTimer = window.setTimeout(clearPendingDelete, 3500);
}

function renderProfiles(profiles, { animate = true } = {}) {
  lastProfiles = profiles;
  renderedProfilesSignature = profileSignature(profiles);
  window.clearTimeout(pendingDeleteTimer);
  pendingDeleteName = null;
  pendingDeleteButton = null;
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
    kind.textContent = profile.isDefault ? t("profile.kindDefault") : t("profile.kindIsolated");
    identity.append(name, kind);

    const status = document.createElement("span");
    status.className = `status${profile.running ? " running" : ""}`;
    status.textContent = profile.running ? t("status.running") : t("status.stopped");

    const actions = document.createElement("div");
    actions.className = "actions";
    const launchLabel = profile.running ? t("action.show") : t("action.launch");
    actions.append(
      createButton(launchLabel, "action", () => runProfileAction("launch_profile", profile.name)),
    );
    if (profile.running) {
      actions.append(
        createButton(t("action.stop"), "action stop", () =>
          runProfileAction("stop_profile", profile.name),
        ),
      );
    }
    if (!profile.isDefault) {
      const deleteButton = createButton(t("action.delete"), "action danger", () =>
        handleDeleteClick(profile, deleteButton),
      );
      actions.append(deleteButton);
    }
    row.append(identity, status, actions);
    list.append(row);
  });
}

async function loadProfiles({ quiet = false } = {}) {
  if (busy || !i18nReady) return;
  if (!quiet && renderedProfilesSignature === null) {
    list.innerHTML = `<p class="loading">${t("profiles.loading")}</p>`;
  }
  try {
    const profiles = await invoke("list_profiles");
    const nextSignature = profileSignature(profiles);
    if (nextSignature !== renderedProfilesSignature) {
      renderProfiles(profiles, { animate: renderedProfilesSignature === null });
    }
  } catch (error) {
    renderedProfilesSignature = null;
    list.innerHTML = `<p class="empty">${t("profiles.loadFailed")}</p>`;
    showMessage(errorText(error), true);
  }
}

async function runProfileAction(command, name, { successKey } = {}) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const profiles = await invoke(command, { name });
    if (Array.isArray(profiles)) {
      renderProfiles(profiles, { animate: false });
    } else {
      window.setTimeout(
        () => loadProfiles({ quiet: true }),
        command === "launch_profile" ? 1300 : 300,
      );
    }
    if (successKey) {
      showMessage(t(successKey));
    }
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
    showMessage(t("message.profileCreated"));
  } catch (error) {
    showMessage(errorText(error), true);
  } finally {
    busy = false;
    submit.disabled = false;
    input.focus();
  }
});

refreshButton.addEventListener("click", () => loadProfiles());

languageToggle.addEventListener("click", async () => {
  if (!i18nReady) return;
  await toggleLocale();
  applyTranslations();
  if (lastProfiles !== null) {
    renderProfiles(lastProfiles, { animate: false });
  }
});

window.setInterval(() => loadProfiles({ quiet: true }), 4000);

(async () => {
  await initI18n();
  i18nReady = true;
  loadProfiles();
})();
