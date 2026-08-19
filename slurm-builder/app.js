(function () {
  "use strict";

  const builder = window.SlurmBuilder;
  const form = document.querySelector("#builder-form");
  const preview = document.querySelector("#script-preview");
  const validationSummary = document.querySelector("#validation-summary");
  const copyButton = document.querySelector("#copy-button");
  const downloadButton = document.querySelector("#download-button");
  const shareButton = document.querySelector("#share-button");
  const copyAiPromptButton = document.querySelector("#copy-ai-prompt");
  const storageKey = "plaksha-slurm-builder-v1";
  let toastTimer;

  const icons = {
    hardware: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3m-3 4h3"/></svg>',
    resources: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/></svg>',
    allocation: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4.2 3-6 7.5-6s6.9 1.8 7.5 6"/></svg>',
    time: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  function selected(name) {
    return form.elements[name].value;
  }

  function readConfig() {
    return builder.normalizeConfig({
      workload: selected("workload"),
      account: form.elements.account.value,
      policy: selected("policy"),
      gpus: form.elements.gpus.value,
      cpus: form.elements.cpus.value,
      memoryGb: form.elements.memory.value,
      days: form.elements.days.value,
      hours: form.elements.hours.value,
      minutes: form.elements.minutes.value,
      jobName: form.elements.jobName.value,
      outputFile: form.elements.outputFile.value,
      command: form.elements.command.value,
    });
  }

  function setRadio(name, value) {
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  function setConfig(config) {
    const c = builder.normalizeConfig(config);
    setRadio("workload", c.workload);
    form.elements.account.value = c.account;
    setRadio("policy", c.policy);
    form.elements.gpus.value = c.gpus || 1;
    form.elements.cpus.value = c.cpus;
    form.elements.memory.value = c.memoryGb;
    form.elements.days.value = c.days;
    form.elements.hours.value = c.hours;
    form.elements.minutes.value = c.minutes;
    form.elements.jobName.value = c.jobName;
    form.elements.outputFile.value = c.outputFile;
    form.elements.command.value = c.command;
  }

  function formatLimit(minutes) {
    return builder.humanDuration(minutes);
  }

  function applyDependencies() {
    const c = readConfig();
    const workload = builder.WORKLOADS[c.workload];
    const account = builder.ACCOUNTS[c.account];
    const standardQos = builder.QOS[account.qos];
    const isGpu = Boolean(workload.gres);
    const isH200 = c.workload === "h200";

    document.querySelector("#gpu-count-field").classList.toggle("hidden", !isGpu);
    form.elements.gpus.max = workload.maxGpus || 1;
    document.querySelector("#gpu-limit").textContent = `Maximum ${workload.maxGpus} on this node.`;

    document.querySelector("#account-help-text").textContent = account.description;
    document.querySelector("#standard-qos-label").textContent = `${account.qos} QoS · up to ${formatLimit(standardQos.maxMinutes)}`;

    const generalOption = document.querySelector("#general-option");
    const generalInput = form.querySelector('input[name="policy"][value="general"]');
    const scavengerInput = form.querySelector('input[name="policy"][value="scavenger"]');
    generalOption.classList.toggle("hidden", c.account === "general");
    generalInput.disabled = isH200 || c.account === "general";
    scavengerInput.disabled = isH200;
    if ((generalInput.disabled && generalInput.checked) || (isH200 && scavengerInput.checked)) {
      setRadio("policy", "standard");
    }
    if (isH200) {
      document.querySelector("#policy-note").textContent = "H200 accepts only the faculty or paid account's matching QoS. QoS limits are enforced at submission.";
    } else if (c.account === "general") {
      document.querySelector("#policy-note").textContent = "The general account can use General or Scavenger QoS on RTX. QoS limits are enforced at submission.";
    } else {
      document.querySelector("#policy-note").textContent = `The ${account.account} account can use ${account.qos}, general, or scavenger QoS on RTX. QoS limits are enforced at submission.`;
    }

    form.elements.memory.max = workload.maxMemoryGb;
    document.querySelector("#memory-limit").textContent = `Maximum ${workload.maxMemoryGb} GB on ${workload.partition.toUpperCase()} nodes.`;

    const qosName = builder.qosFor(readConfig());
    document.querySelector("#time-limit").textContent = `${builder.QOS[qosName].label} QoS allows up to ${formatLimit(builder.QOS[qosName].maxMinutes)}.`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function highlightedScript(script) {
    return script
      .split("\n")
      .map((line) => {
        let className = "";
        if (line.startsWith("#!")) className = "syntax-shebang";
        else if (line.startsWith("#SBATCH")) className = "syntax-directive";
        else if (line.startsWith("#")) className = "syntax-comment";
        else if (line.trim()) className = "syntax-command";
        return className ? `<span class="${className}">${escapeHtml(line)}</span>` : "";
      })
      .join("\n");
  }

  function renderValidation(validation) {
    const messages = [
      ...validation.errors.map((text) => ({ type: "error", label: "Fix", text })),
      ...validation.warnings.map((text) => ({ type: "warning", label: "Note", text })),
    ];
    validationSummary.innerHTML = messages
      .map(
        (message) =>
          `<div class="validation-message ${message.type}"><strong>${message.label}:</strong><span>${escapeHtml(message.text)}</span></div>`,
      )
      .join("");
  }

  function renderSummary(config) {
    document.querySelector("#summary-list").innerHTML = builder
      .summary(config)
      .map(
        (item) => `
          <div class="summary-item">
            ${icons[item.key]}
            <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div>
          </div>`,
      )
      .join("");
  }

  function render() {
    applyDependencies();
    const config = readConfig();
    const script = builder.generateScript(config);
    const validation = builder.validate(config);
    const file = builder.filename(config);

    preview.innerHTML = highlightedScript(script);
    document.querySelector("#line-count").textContent = `${script.split("\n").length} lines`;
    document.querySelector("#result-job-name").textContent = config.jobName || "job";
    document.querySelector("#submit-filename").textContent = file;
    renderValidation(validation);
    renderSummary(config);

    copyButton.disabled = validation.errors.length > 0;
    downloadButton.disabled = validation.errors.length > 0;
    shareButton.disabled = validation.errors.length > 0;

    try {
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch (_) {
      // The builder still works if storage is disabled.
    }
  }

  function restorePreset() {
    const workloadName = selected("workload");
    const preset = builder.WORKLOADS[workloadName].preset;
    const requestedMinutes = preset.days * 1440 + preset.hours * 60 + preset.minutes;
    const qosLimit = builder.QOS[builder.qosFor(readConfig())].maxMinutes;
    const safeMinutes = Math.min(requestedMinutes, qosLimit);
    form.elements.gpus.value = preset.gpus || 1;
    form.elements.cpus.value = preset.cpus;
    form.elements.memory.value = preset.memoryGb;
    form.elements.days.value = Math.floor(safeMinutes / 1440);
    form.elements.hours.value = Math.floor((safeMinutes % 1440) / 60);
    form.elements.minutes.value = safeMinutes % 60;
    render();
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showToast(successMessage);
    }
  }

  function configToUrl(config) {
    const url = new URL(window.location.href);
    url.search = "";
    Object.entries(config).forEach(([key, value]) => {
      if (value !== "" && value !== builder.DEFAULT_CONFIG[key]) url.searchParams.set(key, String(value));
    });
    return url;
  }

  function configFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.size) return null;
    const config = {};
    params.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(builder.DEFAULT_CONFIG, key)) config[key] = value;
    });
    return Object.assign({}, builder.DEFAULT_CONFIG, config);
  }

  function initialConfig() {
    const urlConfig = configFromUrl();
    if (urlConfig) return urlConfig;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (stored && typeof stored === "object") return stored;
    } catch (_) {
      // Use defaults if saved state is unavailable or malformed.
    }
    return builder.DEFAULT_CONFIG;
  }

  form.addEventListener("input", render);
  form.addEventListener("change", (event) => {
    if (event.target.name === "workload") restorePreset();
    else render();
  });

  document.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.querySelector(`#${button.dataset.target}`);
      const min = Number(input.min);
      const max = Number(input.max);
      const next = Number(input.value || min) + Number(button.dataset.step);
      input.value = Math.min(max, Math.max(min, next));
      render();
    });
  });

  document.querySelector("#reset-preset").addEventListener("click", restorePreset);

  copyButton.addEventListener("click", () => {
    copyText(builder.generateScript(readConfig()), "Script copied to clipboard.");
  });

  downloadButton.addEventListener("click", () => {
    const config = readConfig();
    const blob = new Blob([builder.generateScript(config) + "\n"], { type: "text/x-shellscript" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = builder.filename(config);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showToast("Script downloaded.");
  });

  shareButton.addEventListener("click", () => {
    const url = configToUrl(readConfig());
    window.history.replaceState({}, "", url);
    copyText(url.toString(), "Shareable link copied.");
  });

  copyAiPromptButton.addEventListener("click", () => {
    copyText(builder.aiPrompt(readConfig()), "Starter AI prompt copied.");
  });

  document.querySelectorAll("[data-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.dialog}`).showModal());
  });

  document.querySelectorAll(".dialog-close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  setConfig(initialConfig());
  render();
})();
