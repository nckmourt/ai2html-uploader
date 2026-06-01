const state = {
  files: [],
  folderSlug: "",
  htmlPaths: [],
  previewArtboards: [],
  selectedArtboardIndex: 0,
  mainHtmlPath: "",
  previewHtmlPath: "",
  previewUrls: new Map(),
  previewDocumentUrl: "",
  missingPreviewAssets: new Set(),
  embedCode: "",
  embedHeight: 800,
  publicUrl: "",
};

const elements = {
  dropZone: document.querySelector("#drop-zone"),
  folderInput: document.querySelector("#folder-input"),
  fileSummary: document.querySelector("#file-summary"),
  form: document.querySelector("#upload-form"),
  uploadButton: document.querySelector("#upload-button"),
  resetButton: document.querySelector("#reset-button"),
  copyButton: document.querySelector("#copy-button"),
  embedCode: document.querySelector("#embed-code"),
  previewPanel: document.querySelector("#preview-panel"),
  previewTabs: document.querySelector("#preview-tabs"),
  artboardControls: document.querySelector("#artboard-controls"),
  prevArtboard: document.querySelector("#prev-artboard"),
  nextArtboard: document.querySelector("#next-artboard"),
  artboardLabel: document.querySelector("#artboard-label"),
  previewFrame: document.querySelector("#preview-frame"),
  previewEmpty: document.querySelector("#preview-empty"),
  progressLog: document.querySelector("#progress-log"),
};

const DEFAULT_CONFIG = {
  owner: "nckmourt",
  repo: "ai2html-uploader",
  branch: "main",
  pagesBaseUrl: "https://nickmourtoupalas.com/ai2html-uploader/",
};

const DEFAULT_EMBED_MAX_WIDTH = 656;

const TEXT_EXTENSIONS = new Set([
  "css",
  "csv",
  "html",
  "htm",
  "js",
  "json",
  "map",
  "svg",
  "txt",
  "xml",
]);

const URL_ATTRS = [
  ["img", "src"],
  ["script", "src"],
  ["link", "href"],
  ["source", "src"],
  ["video", "src"],
  ["audio", "src"],
  ["iframe", "src"],
  ["embed", "src"],
  ["object", "data"],
];

elements.folderInput.addEventListener("change", async (event) => {
  await loadFileList([...event.target.files]);
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("drag-over");
  });
});

elements.dropZone.addEventListener("drop", async (event) => {
  const entries = [...event.dataTransfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);

  if (!entries.length) {
    showError("No folder was found in that drop. Try dropping the full ai2html output folder or use the folder picker.");
    return;
  }

  try {
    const files = await readDroppedEntries(entries);
    await loadFileList(files);
  } catch (error) {
    showError(error.message);
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await uploadProject(new FormData(elements.form));
});

elements.resetButton.addEventListener("click", () => {
  revokePreviewUrls();
  state.files = [];
  state.folderSlug = "";
  state.htmlPaths = [];
  state.previewArtboards = [];
  state.selectedArtboardIndex = 0;
  state.mainHtmlPath = "";
  state.previewHtmlPath = "";
  state.embedCode = "";
  state.embedHeight = 800;
  state.publicUrl = "";
  elements.folderInput.value = "";
  elements.embedCode.value = "";
  elements.copyButton.disabled = true;
  elements.fileSummary.textContent = "No folder selected yet.";
  elements.previewPanel.classList.add("hidden");
  renderPreviewTabs();
  clearPreview();
  setLog(["Ready."]);
});

elements.copyButton.addEventListener("click", async () => {
  if (!state.embedCode) return;

  try {
    await navigator.clipboard.writeText(state.embedCode);
    appendLog("Embed code copied.", "success");
  } catch {
    elements.embedCode.select();
    document.execCommand("copy");
    appendLog("Embed code copied.", "success");
  }
});

elements.prevArtboard.addEventListener("click", () => {
  cycleArtboard(-1);
});

elements.nextArtboard.addEventListener("click", () => {
  cycleArtboard(1);
});

async function loadFileList(fileList) {
  const files = fileList
    .filter((file) => file.size >= 0)
    .map((file) => ({
      file,
      path: cleanRelativePath(file.webkitRelativePath || file.relativePath || file.name),
    }))
    .filter(({ path }) => path && !path.endsWith("/"));

  if (!files.length) {
    showError("No files were found. Drop the full ai2html output folder, not an empty folder.");
    return;
  }

  const commonRoot = getCommonRoot(files.map(({ path }) => path));
  const normalizedFiles = files.map(({ file, path }) => ({
    file,
    path: commonRoot ? path.slice(commonRoot.length) : path,
  }));

  const duplicatePaths = findDuplicates(normalizedFiles.map(({ path }) => path.toLowerCase()));
  if (duplicatePaths.length) {
    showError(`Path conflict: multiple local files resolve to the same path (${duplicatePaths[0]}).`);
    return;
  }

  const htmlPaths = normalizedFiles
    .filter(({ path }) => /\.html?$/i.test(path))
    .map(({ path }) => path)
    .sort((a, b) => a.localeCompare(b));
  const mainHtmlPath = detectMainHtml(normalizedFiles);
  if (!mainHtmlPath) {
    showError("Missing main HTML file. The folder must include at least one .html file from ai2html.");
    return;
  }

  revokePreviewUrls();
  state.files = normalizedFiles;
  state.folderSlug = normalizeTargetPath(commonRoot ? commonRoot.slice(0, -1) : stripExtension(mainHtmlPath));
  state.htmlPaths = htmlPaths;
  state.mainHtmlPath = mainHtmlPath;
  state.previewHtmlPath = mainHtmlPath;
  state.embedCode = "";
  state.publicUrl = "";
  elements.embedCode.value = "";
  elements.copyButton.disabled = true;
  const mainHtmlFile = normalizedFiles.find((item) => item.path === mainHtmlPath);
  const mainHtml = await mainHtmlFile.file.text();
  state.embedHeight = detectEmbedHeight(mainHtml);
  refreshEmbedCode();

  const assetCount = normalizedFiles.length - 1;
  elements.fileSummary.innerHTML = [
    `<strong>${escapeHtml(normalizedFiles.length.toString())} files detected</strong>`,
    `Main HTML: <code>${escapeHtml(mainHtmlPath)}</code>`,
    `Upload folder: <code>${escapeHtml(state.folderSlug)}</code>`,
    `Assets: ${escapeHtml(assetCount.toString())}`,
  ].join("<br>");
  renderPreviewTabs();
  await updatePreview(mainHtmlPath);
  elements.previewPanel.classList.remove("hidden");
  setLog(["Folder loaded and preview rendered. Paste a token, then upload."]);
}

async function uploadProject(formData) {
  if (!state.files.length || !state.mainHtmlPath) {
    showError("Missing files. Drop or choose an ai2html output folder before uploading.");
    return;
  }

  const config = {
    ...DEFAULT_CONFIG,
    targetPath: state.folderSlug,
    token: getFormValue(formData, "token"),
  };

  const missingField = Object.entries(config).find(([, value]) => !value);
  if (missingField) {
    showError(`Missing ${labelForField(missingField[0])}.`);
    return;
  }

  if (!/^https?:\/\//i.test(config.pagesBaseUrl)) {
    showError("Bad GitHub Pages base URL. Use a full URL like https://owner.github.io/repo/.");
    return;
  }

  if (hasUnsafePathSegment(config.targetPath)) {
    showError("Bad target folder / slug. Remove empty, dot, or parent-directory path segments.");
    return;
  }

  elements.uploadButton.disabled = true;
  elements.uploadButton.textContent = "Uploading...";
  elements.copyButton.disabled = true;
  elements.embedCode.value = "";
  state.embedCode = "";
  setLog(["Preparing files..."]);

  try {
    const publicBaseUrl = joinUrl(config.pagesBaseUrl, config.targetPath);
    const filesToUpload = await prepareFilesForUpload(config, publicBaseUrl);

    appendLog(`Uploading ${filesToUpload.length} files to ${config.owner}/${config.repo}@${config.branch}...`);
    for (const item of filesToUpload) {
      appendLog(`Uploading ${item.remotePath}`);
      await putGitHubFile(config, item);
    }

    const mainUrl = joinUrl(publicBaseUrl, state.mainHtmlPath);
    state.publicUrl = mainUrl;
    refreshEmbedCode();
    elements.copyButton.disabled = false;
    appendLog(`Uploaded successfully: ${mainUrl}`, "success");
  } catch (error) {
    showError(error.message);
  } finally {
    elements.uploadButton.disabled = false;
    elements.uploadButton.textContent = "Upload to GitHub";
  }
}

async function prepareFilesForUpload(config, publicBaseUrl) {
  return Promise.all(state.files.map(async ({ file, path }) => {
    const remotePath = joinPath(config.targetPath, path);
    const isMainHtml = path === state.mainHtmlPath;
    const content = isMainHtml
      ? rewriteHtmlUrls(await file.text(), path, publicBaseUrl)
      : await readFileForGitHub(file, path, publicBaseUrl);

    return {
      content,
      message: `Upload ai2html asset ${remotePath}`,
      remotePath,
    };
  }));
}

async function readFileForGitHub(file, path, publicBaseUrl) {
  if (path.toLowerCase().endsWith(".css")) {
    const css = await file.text();
    return toBase64(rewriteCssUrls(css, path, publicBaseUrl));
  }

  const extension = getExtension(path);
  if (TEXT_EXTENSIONS.has(extension)) {
    return toBase64(await file.text());
  }

  const buffer = await file.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function rewriteHtmlUrls(html, htmlPath, publicBaseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  URL_ATTRS.forEach(([selector, attr]) => {
    doc.querySelectorAll(`${selector}[${attr}]`).forEach((node) => {
      const value = node.getAttribute(attr);
      if (shouldRewriteUrl(value)) {
        node.setAttribute(attr, resolveAssetUrl(value, htmlPath, publicBaseUrl));
      }
    });
  });

  doc.querySelectorAll("[srcset]").forEach((node) => {
    const srcset = node.getAttribute("srcset");
    node.setAttribute("srcset", rewriteSrcset(srcset, htmlPath, publicBaseUrl));
  });

  doc.querySelectorAll("[style]").forEach((node) => {
    const style = node.getAttribute("style");
    node.setAttribute("style", rewriteCssUrls(style, htmlPath, publicBaseUrl));
  });

  doc.querySelectorAll("style").forEach((node) => {
    node.textContent = rewriteCssUrls(node.textContent, htmlPath, publicBaseUrl);
  });

  const rewritten = doc.documentElement.outerHTML;
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] || "<!doctype html>";
  return toBase64(`${doctype}\n${rewritten}`);
}

function createEmbedCode(mainUrl, iframeHeight, maxWidth) {
  const escapedUrl = escapeAttribute(mainUrl);
  const height = Math.max(1, Number(iframeHeight) || 800);
  const wrapperWidth = Math.max(0, Number(maxWidth) || 0);
  const maxWidthStyle = wrapperWidth ? `max-width:${wrapperWidth}px;margin:0 auto;` : "";
  return `<iframe src="${escapedUrl}" width="100%" height="${height}" style="border:0;display:block;overflow:hidden;${maxWidthStyle}" scrolling="no" loading="lazy"></iframe>`;
}

function refreshEmbedCode() {
  if (!state.publicUrl) return;

  state.embedCode = createEmbedCode(
    state.publicUrl,
    state.embedHeight,
    DEFAULT_EMBED_MAX_WIDTH,
  );
  elements.embedCode.value = state.embedCode;
}

function rewriteHtmlForPreview(html, htmlPath, previewUrls) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  URL_ATTRS.forEach(([selector, attr]) => {
    doc.querySelectorAll(`${selector}[${attr}]`).forEach((node) => {
      const value = node.getAttribute(attr);
      if (shouldRewriteUrl(value)) {
        node.setAttribute(attr, resolvePreviewUrl(value, htmlPath, previewUrls));
      }
    });
  });

  doc.querySelectorAll("[srcset]").forEach((node) => {
    const srcset = node.getAttribute("srcset");
    node.setAttribute("srcset", rewritePreviewSrcset(srcset, htmlPath, previewUrls));
  });

  doc.querySelectorAll("[style]").forEach((node) => {
    const style = node.getAttribute("style");
    node.setAttribute("style", rewriteCssUrlsForPreview(style, htmlPath, previewUrls));
  });

  doc.querySelectorAll("style").forEach((node) => {
    node.textContent = rewriteCssUrlsForPreview(node.textContent, htmlPath, previewUrls);
  });

  const rewritten = doc.documentElement.outerHTML;
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] || "<!doctype html>";
  return `${doctype}\n${rewritten}`;
}

function rewriteCssUrls(css, sourcePath, publicBaseUrl) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
    const url = rawUrl.trim();
    if (!shouldRewriteUrl(url)) return match;
    return `url(${quote}${resolveAssetUrl(url, sourcePath, publicBaseUrl)}${quote})`;
  });
}

function rewriteCssUrlsForPreview(css, sourcePath, previewUrls) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, rawUrl) => {
    const url = rawUrl.trim();
    if (!shouldRewriteUrl(url)) return match;
    return `url(${quote}${resolvePreviewUrl(url, sourcePath, previewUrls)}${quote})`;
  });
}

function rewriteSrcset(srcset, sourcePath, publicBaseUrl) {
  if (!srcset) return srcset;

  return srcset.split(",").map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    if (!parts[0] || !shouldRewriteUrl(parts[0])) return candidate.trim();
    parts[0] = resolveAssetUrl(parts[0], sourcePath, publicBaseUrl);
    return parts.join(" ");
  }).join(", ");
}

function rewritePreviewSrcset(srcset, sourcePath, previewUrls) {
  if (!srcset) return srcset;

  return srcset.split(",").map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    if (!parts[0] || !shouldRewriteUrl(parts[0])) return candidate.trim();
    parts[0] = resolvePreviewUrl(parts[0], sourcePath, previewUrls);
    return parts.join(" ");
  }).join(", ");
}

function resolveAssetUrl(rawUrl, sourcePath, publicBaseUrl) {
  const [urlPath, suffix = ""] = splitUrlSuffix(rawUrl);
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const normalized = normalizeRelativeUrlPath(joinPath(sourceDir, safeDecodeURIComponent(urlPath)));
  return `${joinUrl(publicBaseUrl, normalized)}${suffix}`;
}

function resolvePreviewUrl(rawUrl, sourcePath, previewUrls) {
  const [urlPath, suffix = ""] = splitUrlSuffix(rawUrl);
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const normalized = normalizeRelativeUrlPath(joinPath(sourceDir, safeDecodeURIComponent(urlPath)));
  const replacement = previewUrls.get(normalized);
  if (replacement) {
    return replacement.startsWith("data:") ? replacement : `${replacement}${suffix}`;
  }
  state.missingPreviewAssets.add(normalized);
  return rawUrl;
}

function shouldRewriteUrl(url) {
  if (!url) return false;
  const value = url.trim();
  return Boolean(value)
    && !value.startsWith("#")
    && !value.startsWith("//")
    && !/^[a-z][a-z0-9+.-]*:/i.test(value)
    && !value.startsWith("{{");
}

async function updatePreview(htmlPath) {
  try {
    state.previewHtmlPath = htmlPath;
    const previewUrls = await createPreviewUrls();
    const htmlFile = state.files.find((item) => item.path === htmlPath);
    const html = await htmlFile.file.text();
    state.previewArtboards = detectPreviewArtboards(html);
    state.selectedArtboardIndex = getDefaultArtboardIndex(state.previewArtboards);
    const previewHtml = rewriteHtmlForPreview(html, htmlPath, previewUrls);
    state.previewDocumentUrl = URL.createObjectURL(new Blob([previewHtml], { type: "text/html" }));
    elements.previewFrame.onload = applySelectedArtboardPreviewStyles;
    elements.previewFrame.src = state.previewDocumentUrl;
    elements.previewFrame.classList.add("visible");
    elements.previewEmpty.classList.add("hidden");
    renderPreviewTabs();
    renderArtboardControls();
    if (state.missingPreviewAssets.size) {
      appendLog(`Preview warning: ${state.missingPreviewAssets.size} referenced asset(s) were not found in the dropped folder. First missing path: ${[...state.missingPreviewAssets][0]}`, "error");
    }
  } catch (error) {
    clearPreview();
    appendLog(`Preview failed: ${error.message}`, "error");
  }
}

async function createPreviewUrls() {
  revokePreviewUrls();
  const previewUrls = new Map();
  const cssFiles = [];

  for (const item of state.files) {
    if (item.path.toLowerCase().endsWith(".css")) {
      cssFiles.push(item);
      continue;
    }
    previewUrls.set(item.path, await fileToDataUrl(item.file, item.path));
  }

  for (const item of cssFiles) {
    const rewrittenCss = rewriteCssUrlsForPreview(await item.file.text(), item.path, previewUrls);
    previewUrls.set(item.path, textToDataUrl(rewrittenCss, "text/css"));
  }

  state.previewUrls = previewUrls;
  return previewUrls;
}

function detectPreviewArtboards(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const artboards = [...doc.querySelectorAll(".g-artboard")].map((node, index) => {
    const id = node.getAttribute("id") || `Artboard ${index + 1}`;
    const width = getArtboardWidth(node);
    const height = getArtboardHeight(node, width);
    const name = getArtboardName(node, id);
    return {
      id,
      label: width ? `${name} (${width}px)` : name,
      height,
      width,
    };
  });

  return artboards.length ? artboards : [{ id: "preview", label: "Full preview", height: 0, width: 0 }];
}

function detectEmbedHeight(html) {
  const artboards = detectPreviewArtboards(html);
  const tallest = artboards.reduce((height, artboard) => Math.max(height, artboard.height || 0), 0);
  return tallest ? tallest + 20 : 800;
}

function getArtboardWidth(node) {
  const candidates = [
    node.style.width,
    node.style.maxWidth,
    node.getAttribute("data-min-width"),
    node.getAttribute("data-width"),
    node.getAttribute("data-max-width"),
  ];
  const width = candidates
    .map((value) => Number(String(value || "").replace(/[^\d.]/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);
  return width ? Math.round(width) : 0;
}

function getArtboardHeight(node, width) {
  const candidates = [
    node.style.height,
    node.style.maxHeight,
    node.getAttribute("data-height"),
  ];
  const height = candidates
    .map((value) => Number(String(value || "").replace(/[^\d.]/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);

  if (height) return Math.round(height);

  const aspectRatio = Number(node.getAttribute("data-aspect-ratio"));
  return width && aspectRatio ? Math.round(width / aspectRatio) : 0;
}

function getArtboardName(node, id) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === Node.COMMENT_NODE) {
      const match = sibling.nodeValue.match(/Artboard:\s*(.+)/i);
      if (match) return match[1].trim();
    }
    if (sibling.nodeType === Node.ELEMENT_NODE) break;
    sibling = sibling.previousSibling;
  }

  return id.replace(/^g-/, "").trim() || "Artboard";
}

function getDefaultArtboardIndex(artboards) {
  if (!artboards.length) return 0;
  return artboards.reduce((bestIndex, artboard, index) => {
    const bestWidth = artboards[bestIndex].width || 0;
    return artboard.width > bestWidth ? index : bestIndex;
  }, 0);
}

function cycleArtboard(direction) {
  if (!state.previewArtboards.length) return;
  const total = state.previewArtboards.length;
  state.selectedArtboardIndex = (state.selectedArtboardIndex + direction + total) % total;
  renderArtboardControls();
}

function renderArtboardControls() {
  const artboard = state.previewArtboards[state.selectedArtboardIndex];
  const hasMultiple = state.previewArtboards.length > 1;

  elements.artboardControls.hidden = !state.previewArtboards.length;
  elements.prevArtboard.disabled = !hasMultiple;
  elements.nextArtboard.disabled = !hasMultiple;
  elements.artboardLabel.textContent = artboard ? artboard.label : "Preview";

  if (artboard?.width) {
    elements.previewFrame.style.width = `${artboard.width}px`;
    elements.previewFrame.style.height = `${artboard.height || 620}px`;
  } else {
    elements.previewFrame.style.width = "100%";
    elements.previewFrame.style.height = "620px";
  }
  applySelectedArtboardPreviewStyles();
}

function applySelectedArtboardPreviewStyles() {
  try {
    const doc = elements.previewFrame.contentDocument;
    if (!doc) return;
    const selected = state.previewArtboards[state.selectedArtboardIndex];
    const targetWidth = selected?.width || 0;
    const targetHeight = selected?.height || 0;

    doc.documentElement.style.margin = "0";
    doc.documentElement.style.padding = "0";
    doc.documentElement.style.overflow = "hidden";
    doc.body.style.margin = "0";
    doc.body.style.padding = "0";
    doc.body.style.overflow = "hidden";
    if (targetWidth) {
      doc.documentElement.style.width = `${targetWidth}px`;
      doc.documentElement.style.maxWidth = `${targetWidth}px`;
      doc.body.style.width = `${targetWidth}px`;
      doc.body.style.maxWidth = `${targetWidth}px`;
    }
    if (targetHeight) {
      doc.documentElement.style.height = `${targetHeight}px`;
      doc.body.style.height = `${targetHeight}px`;
    }

    state.previewArtboards.forEach((artboard, index) => {
      const node = doc.getElementById(artboard.id);
      if (!node) return;

      const isSelected = index === state.selectedArtboardIndex;
      node.style.display = isSelected ? "block" : "none";
      if (isSelected && artboard.width) {
        node.style.width = `${artboard.width}px`;
        node.style.maxWidth = `${artboard.width}px`;
        node.style.margin = "0";
      }
    });

    const selectedNode = selected ? doc.getElementById(selected.id) : null;
    if (selectedNode) {
      const rect = selectedNode.getBoundingClientRect();
      const width = Math.ceil(selected.width || rect.width || 0);
      const height = Math.ceil(selected.height || rect.height || 0);
      if (width) elements.previewFrame.style.width = `${width}px`;
      if (height) elements.previewFrame.style.height = `${height}px`;
    }
  } catch {
    // Cross-frame inspection can fail in some browser contexts; the preview still falls back to ai2html CSS.
  }
}

function revokePreviewUrls() {
  if (state.previewDocumentUrl) {
    URL.revokeObjectURL(state.previewDocumentUrl);
    state.previewDocumentUrl = "";
  }
  state.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewUrls.clear();
  state.missingPreviewAssets.clear();
}

function renderPreviewTabs() {
  elements.previewTabs.innerHTML = "";

  state.htmlPaths.forEach((path) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preview-tab${path === state.previewHtmlPath ? " active" : ""}`;
    button.textContent = displayHtmlName(path);
    button.title = path;
    button.addEventListener("click", () => updatePreview(path));
    elements.previewTabs.append(button);
  });
}

function displayHtmlName(path) {
  const fileName = path.split("/").pop() || path;
  return fileName.replace(/\.html?$/i, "");
}

function clearPreview() {
  elements.previewFrame.removeAttribute("src");
  elements.previewFrame.style.width = "";
  elements.previewFrame.style.height = "";
  elements.previewFrame.classList.remove("visible");
  elements.previewEmpty.classList.remove("hidden");
  elements.previewTabs.innerHTML = "";
  elements.artboardControls.hidden = true;
}

async function putGitHubFile(config, item) {
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodeGitHubPath(item.remotePath)}`;
  const sha = await getExistingSha(endpoint, config);

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: githubHeaders(config.token),
    body: JSON.stringify({
      branch: config.branch,
      content: item.content,
      message: item.message,
      sha,
    }),
  });

  if (!response.ok) {
    throw await githubError(response, `Failed upload for ${item.remotePath}`);
  }
}

async function getExistingSha(endpoint, config) {
  const response = await fetch(`${endpoint}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token),
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw await githubError(response, "Could not check existing GitHub files");
  }

  const data = await response.json();
  if (data.type !== "file") {
    throw new Error(`Path conflict: a non-file already exists at ${data.path}. Choose a different target folder or remove the conflict in GitHub.`);
  }

  return data.sha;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubError(response, fallback) {
  let details = "";
  try {
    const data = await response.json();
    details = data.message ? ` ${data.message}` : "";
  } catch {
    details = ` ${response.statusText}`;
  }

  if (response.status === 401 || response.status === 403) {
    return new Error(`${fallback}. Bad token or missing repository contents permission.${details}`);
  }

  if (response.status === 404) {
    return new Error(`${fallback}. Repo, branch, or path was not found. Check owner, repo, branch, and token access.${details}`);
  }

  if (response.status === 409 || response.status === 422) {
    return new Error(`${fallback}. Path conflict or invalid file path.${details}`);
  }

  return new Error(`${fallback}. GitHub returned ${response.status}.${details}`);
}

async function readDroppedEntries(entries) {
  const allFiles = [];

  for (const entry of entries) {
    if (entry.isFile) {
      allFiles.push(await readEntryFile(entry, ""));
    } else if (entry.isDirectory) {
      allFiles.push(...await readDirectory(entry, ""));
    }
  }

  return allFiles;
}

async function readDirectory(directoryEntry, parentPath) {
  const reader = directoryEntry.createReader();
  const entries = [];
  let batch = [];

  do {
    batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    entries.push(...batch);
  } while (batch.length);

  const currentPath = joinPath(parentPath, directoryEntry.name);
  const files = [];
  for (const entry of entries) {
    if (entry.isFile) {
      files.push(await readEntryFile(entry, currentPath));
    } else if (entry.isDirectory) {
      files.push(...await readDirectory(entry, currentPath));
    }
  }
  return files;
}

function readEntryFile(fileEntry, parentPath) {
  return new Promise((resolve, reject) => {
    fileEntry.file((file) => {
      Object.defineProperty(file, "relativePath", {
        value: joinPath(parentPath, file.name),
        configurable: true,
      });
      resolve(file);
    }, reject);
  });
}

function detectMainHtml(files) {
  const htmlFiles = files.filter(({ path }) => /\.html?$/i.test(path));
  if (!htmlFiles.length) return "";

  const byName = htmlFiles.find(({ path }) => /(^|\/)(index|ai2html)\.html?$/i.test(path));
  if (byName) return byName.path;

  const likelyAi2html = htmlFiles.find(({ path }) => path.toLowerCase().includes("ai2html"));
  if (likelyAi2html) return likelyAi2html.path;

  return htmlFiles.sort((a, b) => b.file.size - a.file.size)[0].path;
}

function getCommonRoot(paths) {
  if (!paths.every((path) => path.includes("/"))) return "";
  const roots = new Set(paths.map((path) => path.split("/")[0]));
  return roots.size === 1 ? `${[...roots][0]}/` : "";
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
}

function getFormValue(formData, field) {
  return String(formData.get(field) || "").trim();
}

function labelForField(field) {
  return {
    owner: "GitHub owner",
    repo: "repo",
    branch: "branch",
    targetPath: "target folder / slug",
    pagesBaseUrl: "GitHub Pages base URL",
    token: "token",
  }[field] || field;
}

function cleanRelativePath(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function normalizeTargetPath(path) {
  return cleanRelativePath(path).replace(/\/$/, "");
}

function normalizeBaseUrl(url) {
  return url.trim().replace(/\/+$/, "/");
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");
}

function joinUrl(baseUrl, ...parts) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanParts = parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return [cleanBase, ...cleanParts.map(encodeUrlPath)].join("/");
}

function normalizeRelativeUrlPath(path) {
  const parts = [];
  cleanRelativePath(path).split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      parts.pop();
      return;
    }
    parts.push(part);
  });
  return parts.join("/");
}

function hasUnsafePathSegment(path) {
  return cleanRelativePath(path).split("/").some((part) => !part || part === "." || part === "..");
}

function splitUrlSuffix(url) {
  const index = url.search(/[?#]/);
  return index === -1 ? [url, ""] : [url.slice(0, index), url.slice(index)];
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeGitHubPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function encodeUrlPath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function getExtension(path) {
  return path.includes(".") ? path.split(".").pop().toLowerCase() : "";
}

function stripExtension(path) {
  const name = path.split("/").pop() || "ai2html-upload";
  return name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
}

function toBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function fileToDataUrl(file, path) {
  const mimeType = file.type || mimeTypeForPath(path);
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  return `data:${mimeType};base64,${base64}`;
}

function textToDataUrl(text, mimeType) {
  return `data:${mimeType};base64,${toBase64(text)}`;
}

function mimeTypeForPath(path) {
  const extension = getExtension(path);
  return {
    avif: "image/avif",
    css: "text/css",
    gif: "image/gif",
    htm: "text/html",
    html: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    mjs: "text/javascript",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  }[extension] || "application/octet-stream";
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function escapeAttribute(text) {
  return text.replace(/"/g, "&quot;");
}

function setLog(messages) {
  elements.progressLog.innerHTML = "";
  messages.forEach((message) => appendLog(message));
}

function appendLog(message, className = "") {
  const line = document.createElement("p");
  line.textContent = message;
  if (className) line.className = className;
  elements.progressLog.append(line);
  elements.progressLog.scrollTop = elements.progressLog.scrollHeight;
}

function showError(message) {
  setLog([message]);
  elements.progressLog.lastElementChild?.classList.add("error");
}
