import { applyTranslations, initI18n, t, toggleLocale } from "./i18n.js";

const { invoke } = window.__TAURI__.core;

const list = document.querySelector("#profile-list");
const form = document.querySelector("#create-form");
const input = document.querySelector("#profile-name");
const refreshButton = document.querySelector("#refresh-button");
const languageToggle = document.querySelector("#language-toggle");
const message = document.querySelector("#message");
const confirmationModal = document.querySelector("#confirmation-modal");
const confirmationBackdrop = document.querySelector("#confirmation-backdrop");
const confirmationDialog = document.querySelector("#confirmation-dialog");
const confirmationTitle = document.querySelector("#confirmation-title");
const confirmationDescription = document.querySelector("#confirmation-description");
const confirmationCancel = document.querySelector("#confirmation-cancel");
const confirmationAccept = document.querySelector("#confirmation-accept");

let messageTimer;
let busy = false;
let renderedProfilesSignature = null;
let lastProfiles = null;
let i18nReady = false;
let pendingConfirmation = null;

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

function closeConfirmation({ restoreFocus = true } = {}) {
  const trigger = pendingConfirmation?.trigger;
  pendingConfirmation = null;
  confirmationModal.hidden = true;
  if (restoreFocus && trigger?.isConnected) {
    trigger.focus();
  }
}

function showConfirmation({ command, name, successKey, kind, trigger }) {
  if (busy) return;

  pendingConfirmation = { command, name, successKey, trigger };
  const isDelete = kind === "delete";
  confirmationTitle.textContent = t(isDelete ? "confirm.deleteTitle" : "confirm.stopTitle");
  confirmationDescription.textContent = t(isDelete ? "confirm.delete" : "confirm.stop", { name });
  confirmationCancel.textContent = t("confirm.cancel");
  confirmationBackdrop.setAttribute("aria-label", t("confirm.cancel"));
  confirmationAccept.textContent = t(isDelete ? "confirm.deleteAction" : "confirm.stopAction");
  confirmationAccept.className = `confirmation-accept ${isDelete ? "danger" : "stop"}`;
  confirmationModal.hidden = false;
  confirmationAccept.focus();
}

function confirmProfileAction() {
  const action = pendingConfirmation;
  if (!action) return;

  closeConfirmation({ restoreFocus: false });
  // This replaces window.confirm(), which macOS WKWebView does not present in this app.
  console.info("Profile action confirmed", { command: action.command, name: action.name });
  void runProfileAction(action.command, action.name, { successKey: action.successKey });
}

function profileSignature(profiles) {
  return JSON.stringify(profiles);
}

function renderProfiles(profiles, { animate = true } = {}) {
  lastProfiles = profiles;
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
      createButton(t("action.openFolder"), "action", () =>
        runProfileAction("open_profile_directory", profile.name, { refresh: false }),
      ),
    );
    if (profile.running) {
      actions.append(
        createButton(t("action.stop"), "action stop", (event) =>
          showConfirmation({
            command: "stop_profile",
            name: profile.name,
            kind: "stop",
            trigger: event.currentTarget,
          }),
        ),
      );
    }
    if (!profile.isDefault) {
      actions.append(
        createButton(t("action.delete"), "action danger", (event) =>
          showConfirmation({
            command: "delete_profile",
            name: profile.name,
            successKey: "message.profileDeleted",
            kind: "delete",
            trigger: event.currentTarget,
          }),
        ),
      );
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

async function runProfileAction(command, name, { successKey, refresh = true } = {}) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const profiles = await invoke(command, { name });
    if (Array.isArray(profiles)) {
      renderProfiles(profiles, { animate: false });
    } else if (refresh) {
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

confirmationCancel.addEventListener("click", () => closeConfirmation());
confirmationBackdrop.addEventListener("click", () => closeConfirmation());
confirmationAccept.addEventListener("click", confirmProfileAction);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmationModal.hidden) {
    event.preventDefault();
    closeConfirmation();
  }
});

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
