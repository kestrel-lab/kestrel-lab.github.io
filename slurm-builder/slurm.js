(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SlurmBuilder = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORKLOADS = Object.freeze({
    cpu: {
      label: "CPU-only job",
      hardware: "CPU only",
      partition: "rtx",
      gres: null,
      maxGpus: 0,
      maxMemoryGb: 500,
      preset: { gpus: 0, cpus: 4, memoryGb: 32, days: 0, hours: 1, minutes: 0 },
    },
    rtx24: {
      label: "RTX 24 GB job",
      hardware: "RTX 24 GB GPU slice",
      partition: "rtx",
      gres: "gpu:1g.24gb",
      maxGpus: 4,
      maxMemoryGb: 500,
      preset: { gpus: 1, cpus: 4, memoryGb: 32, days: 0, hours: 1, minutes: 0 },
    },
    rtx48: {
      label: "RTX 48 GB job",
      hardware: "RTX 48 GB GPU slice",
      partition: "rtx",
      gres: "gpu:2g.48gb",
      maxGpus: 2,
      maxMemoryGb: 500,
      preset: { gpus: 1, cpus: 8, memoryGb: 64, days: 0, hours: 4, minutes: 0 },
    },
    h200: {
      label: "H200 job",
      hardware: "NVIDIA H200 NVL GPU",
      partition: "h200",
      gres: "gpu:nvidia_h200_nvl",
      maxGpus: 2,
      maxMemoryGb: 751,
      preset: { gpus: 1, cpus: 16, memoryGb: 128, days: 0, hours: 8, minutes: 0 },
    },
  });

  const ACCOUNTS = Object.freeze({
    general: {
      label: "General",
      account: "general",
      qos: "general",
      description: "Uses the general allocation available to all users.",
    },
    courses: {
      label: "Course",
      account: "courses",
      qos: "course",
      description: "Uses an allocation associated with an HPC-enabled course.",
    },
    faculty: {
      label: "Faculty",
      account: "faculty",
      qos: "faculty",
      description: "Uses the free monthly faculty research allocation.",
    },
    rfphd: {
      label: "RF / PhD",
      account: "rfphd",
      qos: "rfphd",
      description: "Uses the free research allocation for RFs and PhD students.",
    },
    paid: {
      label: "Paid",
      account: null,
      qos: "paid",
      description: "Uses purchased credits from a paid sub-account.",
    },
  });

  const QOS = Object.freeze({
    paid: { label: "Paid", maxMinutes: 7 * 24 * 60 },
    faculty: { label: "Faculty", maxMinutes: 3 * 24 * 60 },
    rfphd: { label: "RF / PhD", maxMinutes: 5 * 24 * 60 },
    course: { label: "Course", maxMinutes: 4 * 60 },
    general: { label: "General", maxMinutes: 2 * 60 },
    scavenger: { label: "Scavenger", maxMinutes: 4 * 60 },
  });

  const DEFAULT_CONFIG = Object.freeze({
    workload: "cpu",
    account: "general",
    paidAccount: "",
    policy: "standard",
    gpus: 0,
    cpus: 4,
    memoryGb: 32,
    days: 0,
    hours: 1,
    minutes: 0,
    jobName: "my_job",
    outputFile: "slurm-%j.out",
    command: "python train.py",
    environment: "cluster",
    containerImage: "",
    bindMounts: "",
    containerArgs: "",
    condaEnv: "",
    customSetup: "",
  });

  function integer(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeConfig(input) {
    const raw = Object.assign({}, DEFAULT_CONFIG, input || {});
    const workload = WORKLOADS[raw.workload] ? raw.workload : DEFAULT_CONFIG.workload;
    const account = ACCOUNTS[raw.account] ? raw.account : DEFAULT_CONFIG.account;
    const environment = ["cluster", "singularity", "conda", "custom"].includes(raw.environment)
      ? raw.environment
      : "cluster";
    const policy = raw.policy === "scavenger" && workload !== "h200" ? "scavenger" : "standard";

    return {
      workload,
      account,
      paidAccount: String(raw.paidAccount || "").trim(),
      policy,
      gpus: integer(raw.gpus, WORKLOADS[workload].preset.gpus),
      cpus: integer(raw.cpus, WORKLOADS[workload].preset.cpus),
      memoryGb: integer(raw.memoryGb, WORKLOADS[workload].preset.memoryGb),
      days: integer(raw.days, 0),
      hours: integer(raw.hours, 0),
      minutes: integer(raw.minutes, 0),
      jobName: String(raw.jobName || "").trim(),
      outputFile: String(raw.outputFile || "").trim(),
      command: String(raw.command || "").trim(),
      environment,
      containerImage: String(raw.containerImage || "").trim(),
      bindMounts: String(raw.bindMounts || "").trim(),
      containerArgs: String(raw.containerArgs || "").trim(),
      condaEnv: String(raw.condaEnv || "").trim(),
      customSetup: String(raw.customSetup || "").replace(/\r\n/g, "\n").trim(),
    };
  }

  function qosFor(config) {
    const normalized = normalizeConfig(config);
    return normalized.policy === "scavenger" ? "scavenger" : ACCOUNTS[normalized.account].qos;
  }

  function accountFor(config) {
    const normalized = normalizeConfig(config);
    return normalized.account === "paid" ? normalized.paidAccount : ACCOUNTS[normalized.account].account;
  }

  function totalMinutes(config) {
    const normalized = normalizeConfig(config);
    return normalized.days * 1440 + normalized.hours * 60 + normalized.minutes;
  }

  function humanDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return "0 minutes";
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    const parts = [];
    if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
    if (mins) parts.push(`${mins} ${mins === 1 ? "minute" : "minutes"}`);
    return parts.join(" ");
  }

  function slurmTime(config) {
    const normalized = normalizeConfig(config);
    const hh = String(normalized.hours).padStart(2, "0");
    const mm = String(normalized.minutes).padStart(2, "0");
    return normalized.days > 0 ? `${normalized.days}-${hh}:${mm}:00` : `${hh}:${mm}:00`;
  }

  function hasLineBreak(value) {
    return /[\r\n]/.test(value);
  }

  function validate(config) {
    const c = normalizeConfig(config);
    const workload = WORKLOADS[c.workload];
    const qosName = qosFor(c);
    const errors = [];
    const warnings = [];

    if (!c.jobName) {
      errors.push("Enter a job name.");
    } else if (!/^[A-Za-z0-9._-]+$/.test(c.jobName)) {
      errors.push("Job name may contain only letters, numbers, dots, underscores, and hyphens.");
    }

    if (!c.outputFile) {
      errors.push("Enter an output filename.");
    } else if (hasLineBreak(c.outputFile)) {
      errors.push("Output filename must stay on one line.");
    }

    if (!c.command) {
      errors.push("Enter the command that runs your program.");
    } else if (hasLineBreak(c.command)) {
      errors.push("The main program command must stay on one line. Use Custom setup for additional commands.");
    }

    if (c.account === "paid") {
      if (!c.paidAccount) errors.push("Enter the paid Slurm account assigned to you.");
      else if (!/^paid-[A-Za-z0-9._-]+$/.test(c.paidAccount)) {
        errors.push("Paid account names must start with “paid-” and contain no spaces.");
      }
    }

    if (c.workload === "h200" && !["faculty", "paid"].includes(c.account)) {
      errors.push("H200 jobs require a faculty or paid account.");
    }

    if (c.workload === "h200" && c.policy === "scavenger") {
      errors.push("Scavenger QoS is available only on the RTX partition.");
    }

    if (workload.gres) {
      if (c.gpus < 1 || c.gpus > workload.maxGpus) {
        errors.push(`Choose between 1 and ${workload.maxGpus} GPUs for this hardware.`);
      }
    }

    if (c.cpus < 1 || c.cpus > 128) errors.push("CPU threads must be between 1 and 128.");
    if (c.memoryGb < 1 || c.memoryGb > workload.maxMemoryGb) {
      errors.push(`Memory must be between 1 and ${workload.maxMemoryGb} GB on this node.`);
    }

    if (c.days < 0 || c.days > 7 || c.hours < 0 || c.hours > 23 || c.minutes < 0 || c.minutes > 59) {
      errors.push("Runtime fields are outside their allowed ranges.");
    }

    const requestedMinutes = totalMinutes(c);
    if (requestedMinutes < 1) errors.push("Runtime must be at least one minute.");
    if (requestedMinutes > QOS[qosName].maxMinutes) {
      errors.push(`${QOS[qosName].label} QoS allows at most ${humanDuration(QOS[qosName].maxMinutes)}.`);
    }

    if (c.memoryGb < c.cpus * 8) {
      warnings.push(
        `You requested less than the cluster default of 8 GB per CPU (${c.cpus * 8} GB for ${c.cpus} CPUs). This is valid if your program needs less.`,
      );
    }

    if (c.policy === "scavenger") {
      warnings.push("Scavenger jobs have the lowest priority and may be preempted and requeued. Save checkpoints when practical.");
    }

    if (workload.gres && c.cpus > 32 * c.gpus) {
      warnings.push("This is a high CPU request for the selected GPU count and may increase queue time.");
    }

    if (c.environment === "singularity") {
      if (!c.containerImage) errors.push("Enter the path to your Singularity image.");
      else if (hasLineBreak(c.containerImage)) errors.push("Container image path must stay on one line.");
      if (hasLineBreak(c.bindMounts)) errors.push("Bind mounts must stay on one line.");
      if (hasLineBreak(c.containerArgs)) errors.push("Extra Singularity arguments must stay on one line.");
    }

    if (c.environment === "conda") {
      if (!c.condaEnv) errors.push("Enter a Conda environment name.");
      else if (!/^[A-Za-z0-9._-]+$/.test(c.condaEnv)) {
        errors.push("Conda environment name contains unsupported characters.");
      }
    }

    return { errors, warnings };
  }

  function shellQuote(value) {
    const text = String(value);
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
    return `'${text.replace(/'/g, `'"'"'`)}'`;
  }

  function executionCommand(config) {
    const c = normalizeConfig(config);
    if (c.environment === "singularity") {
      const args = ["srun", "singularity", "exec"];
      if (WORKLOADS[c.workload].gres) args.push("--nv");
      if (c.bindMounts) args.push("--bind", shellQuote(c.bindMounts));
      if (c.containerArgs) args.push(c.containerArgs);
      args.push(shellQuote(c.containerImage), c.command);
      return args.join(" ");
    }
    if (c.environment === "conda") {
      return `srun conda run --no-capture-output -n ${shellQuote(c.condaEnv)} ${c.command}`;
    }
    return `srun ${c.command}`;
  }

  function generateScript(config) {
    const c = normalizeConfig(config);
    const workload = WORKLOADS[c.workload];
    const lines = [
      "#!/bin/bash",
      `#SBATCH --job-name=${c.jobName}`,
      `#SBATCH --account=${accountFor(c)}`,
      `#SBATCH --partition=${workload.partition}`,
      `#SBATCH --qos=${qosFor(c)}`,
    ];

    if (workload.gres) lines.push(`#SBATCH --gres=${workload.gres}:${c.gpus}`);
    lines.push(
      "#SBATCH --nodes=1",
      "#SBATCH --ntasks=1",
      `#SBATCH --cpus-per-task=${c.cpus}`,
      `#SBATCH --mem=${c.memoryGb}G`,
      `#SBATCH --time=${slurmTime(c)}`,
      `#SBATCH --output=${c.outputFile}`,
      "",
    );

    if (c.environment === "custom" && c.customSetup) {
      lines.push("# Environment setup", ...c.customSetup.split("\n"), "");
    }

    lines.push(executionCommand(c));
    return lines.join("\n");
  }

  function summary(config) {
    const c = normalizeConfig(config);
    const workload = WORKLOADS[c.workload];
    const qosName = qosFor(c);
    const hardwareDetail = workload.gres
      ? `${c.gpus} × ${workload.hardware}`
      : "CPU-only workload on the RTX partition";
    const environmentLabels = {
      cluster: "Cluster default environment",
      singularity: `Singularity · ${c.containerImage || "image not set"}`,
      conda: `Conda · ${c.condaEnv || "environment not set"}`,
      custom: "Custom environment setup",
    };

    return [
      { key: "hardware", title: "Hardware", detail: hardwareDetail },
      { key: "resources", title: "Compute resources", detail: `${c.cpus} CPU threads · ${c.memoryGb} GB RAM · one node` },
      { key: "allocation", title: "Allocation & policy", detail: `${accountFor(c) || "Account not set"} account · ${qosName} QoS` },
      { key: "time", title: "Maximum runtime", detail: humanDuration(totalMinutes(c)) },
      { key: "environment", title: "Environment", detail: environmentLabels[c.environment] },
    ];
  }

  function filename(config) {
    const c = normalizeConfig(config);
    return `${c.jobName || "job"}.slurm`;
  }

  function aiPrompt(config) {
    const c = normalizeConfig(config);
    const workload = WORKLOADS[c.workload];
    const selectedAccount = accountFor(c) || "[ENTER AN ACCOUNT ASSIGNED TO YOU]";
    return `Using the attached Plaksha HPC Slurm guide and my workload information below, recommend a conservative but efficient single-node job configuration.

Explain your choices for GPU type and count, CPU threads, total RAM, wall time, account, and QoS. Follow only the cluster options in the attached guide; do not invent hardware, partitions, QoS names, or Slurm settings. Point out anything that must be measured or confirmed.

Run command:
${c.command || "[ENTER THE COMMAND]"}

Current workload category:
${workload.label}

Slurm account I expect to use:
${selectedAccount}

Framework and code:
[ATTACH THE CODE, OR DESCRIBE THE FRAMEWORK AND WHAT THE PROGRAM DOES]

Typical input or dataset size:
[DESCRIBE THE INPUT SIZE]

Previous runtime or memory measurements, if any:
[ADD MEASUREMENTS OR WRITE “NONE”]

Other requirements:
[FOR EXAMPLE: REQUIRED GPU MEMORY OR CHECKPOINT/RESTART SUPPORT]

Return recommended values that I can enter in the Plaksha HPC Job Script Builder. Treat the result as a starting estimate and suggest a smaller representative test run when practical. Do not request or expose passwords, API keys, credentials, private datasets, or other secrets.`;
  }

  return {
    WORKLOADS,
    ACCOUNTS,
    QOS,
    DEFAULT_CONFIG,
    normalizeConfig,
    qosFor,
    accountFor,
    totalMinutes,
    humanDuration,
    slurmTime,
    validate,
    shellQuote,
    executionCommand,
    generateScript,
    summary,
    filename,
    aiPrompt,
  };
});
