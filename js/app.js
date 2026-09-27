(() => {
  const SITE = window.SITE || {};
  const ARCHIVE_RE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|iso|dmg|exe|msi|pkg)$/i;
  const $ = (id) => document.getElementById(id);
  const ui = {
    title: $("title"),
    subtitle: $("subtitle"),
    status: $("status"),
    ready: $("ready"),
    verify: document.querySelector(".verify"),
    passwordValue: $("passwordValue"),
    passwordLine: document.getElementById("passwordValue") && document.getElementById("passwordValue").closest(".line"),
    repoLink: $("repoLink"),
    primary: $("primary"),
  };

  const state = {
    busy: false,
    started: false,
    revealed: false,
    asset: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function applyCopy() {
    const owner = SITE.owner || "github";
    const repo = SITE.repo || "repository";
    ui.repoLink.href = `https://github.com/${owner}/${repo}`;
    ui.title.textContent = SITE.title || "Download the Latest Release";
    const subtitle =
      SITE.subtitle ||
      "Click the button to download the file\nFor installation, follow the instructions in the archive";
    ui.subtitle.innerHTML = subtitle
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    state.password = String(SITE.archivePassword || "").trim();
    if (ui.ready) ui.ready.textContent = "Ready to download · Secure connection";
    if (ui.passwordValue && state.password) ui.passwordValue.textContent = state.password;
  }

  async function revealPassword() {
    if (!ui.verify || state.revealed) return;
    state.revealed = true;
    const swaps = [...ui.verify.querySelectorAll(".swap")];
    const outgoing = swaps.map((swap) => swap.querySelector(".line.show"));
    const incoming = swaps.map((swap) =>
      [...swap.querySelectorAll(".line")].find((line) => !line.classList.contains("show"))
    );

    const outAnimations = outgoing.map((line) =>
      line.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-18px)" },
        ],
        { duration: 340, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }
      )
    );
    await Promise.all(outAnimations.map((animation) => animation.finished));

    outgoing.forEach((line) => line.classList.remove("show"));
    incoming.forEach((line) => line.classList.add("show"));
    outAnimations.forEach((animation) => animation.cancel());

    const inAnimations = incoming.map((line) =>
      line.animate(
        [
          { opacity: 0, transform: "translateY(18px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 460, easing: "cubic-bezier(.16, 1, .3, 1)" }
      )
    );
    await Promise.all(inAnimations.map((animation) => animation.finished));
  }

  async function swapChip(text) {
    const el = ui.passwordValue;
    await el.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-5px)" },
      ],
      { duration: 180, easing: "ease", fill: "forwards" }
    ).finished;
    el.textContent = text;
    el.animate(
      [
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 240, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "forwards" }
    );
  }

  async function copyPassword() {
    const password = state.password;
    if (!password || !ui.passwordValue || state.copying) return;
    state.copying = true;
    try {
      await navigator.clipboard.writeText(password);
    } catch {
      const field = document.createElement("textarea");
      field.value = password;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    await swapChip("Copied");
    await sleep(900);
    await swapChip(password);
    state.copying = false;
  }

  function unmaskDomain(input) {
    const raw = String(input || "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function readQuery() {
    const q = new URLSearchParams(location.search);
    return {
      releaseUrl: unmaskDomain(q.get("release") || q.get("url") || SITE.releaseUrl || ""),
      assetName: q.get("file") || SITE.assetName || "",
    };
  }

  function parseGithub(input) {
    if (!input) return null;
    try {
      const u = new URL(input);
      if (u.hostname !== "github.com") return { kind: "direct", url: input };
      const parts = u.pathname.replace(/^\/|\/$/g, "").split("/");
      const [owner, repo, section, a, b] = parts;
      if (!owner || !repo) return null;
      if (section === "releases" && a === "download" && b) {
        return {
          kind: "asset",
          owner,
          repo,
          tag: decodeURIComponent(b),
          file: decodeURIComponent(parts.slice(5).join("/")),
          page: `https://github.com/${owner}/${repo}`,
        };
      }
      if (section === "releases" && a === "tag" && b) {
        return { kind: "tag", owner, repo, tag: decodeURIComponent(b), page: `https://github.com/${owner}/${repo}` };
      }
      return { kind: "latest", owner, repo, page: `https://github.com/${owner}/${repo}` };
    } catch {
      return null;
    }
  }

  async function githubJson(path) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? "Release not found."
          : res.status === 403
            ? "GitHub rate limit. Wait a minute and try again."
            : `GitHub error ${res.status}.`
      );
    }
    return res.json();
  }

  function pickAsset(release, wanted) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    if (wanted) {
      const match = assets.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
      if (match) return match;
    }
    return assets.find((a) => ARCHIVE_RE.test(a.name)) || assets[0] || null;
  }

  async function resolveAsset(cfg) {
    const parsed = parseGithub(cfg.releaseUrl);
    if (!parsed) throw new Error("No release URL set.");

    if (parsed.kind === "direct") {
      ui.repoLink.href = parsed.url;
      return {
        name: cfg.assetName || parsed.url.split("/").pop() || "download.bin",
        browser_download_url: parsed.url,
        size: 0,
      };
    }

    ui.repoLink.href = parsed.page;

    if (parsed.kind === "asset") {
      try {
        const release = await githubJson(
          `/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`
        );
        return pickAsset(release, cfg.assetName || parsed.file) || {
          name: parsed.file,
          browser_download_url: `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag}/${parsed.file}`,
          size: 0,
        };
      } catch {
        return {
          name: parsed.file,
          browser_download_url: `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${parsed.tag}/${parsed.file}`,
          size: 0,
        };
      }
    }

    const path =
      parsed.kind === "tag"
        ? `/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(parsed.tag)}`
        : `/repos/${parsed.owner}/${parsed.repo}/releases/latest`;
    const release = await githubJson(path);
    const asset = pickAsset(release, cfg.assetName);
    if (!asset) throw new Error("No files in this release.");
    return asset;
  }

  function nativeSave(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    state.started = true;
    if (ui.primary) ui.primary.disabled = true;

    try {
      const asset = state.asset || (await resolveAsset(readQuery()));
      state.asset = asset;
      await revealPassword();
      nativeSave(asset.browser_download_url, asset.name);
      await sleep(240);
    } catch {
      if (ui.status) ui.status.textContent = "Download failed";
    } finally {
      if (ui.primary) ui.primary.disabled = false;
      state.busy = false;
    }
  }

  applyCopy();
  if (ui.passwordLine) ui.passwordLine.addEventListener("click", copyPassword);
  if (ui.primary) ui.primary.addEventListener("click", run);

  window.addEventListener(
    "load",
    async () => {
      try {
        state.asset = await resolveAsset(readQuery());
      } catch {
        state.asset = null;
      }
    },
    { once: true }
  );
})();
