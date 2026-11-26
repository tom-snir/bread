// Bread site: recipe list, recipe page, bake log, and saving bakes through the GitHub API.

const OWNER = 'tom-snir';
const REPO = 'bread';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const MAX_PHOTO_SIZE = 1600; // longest side of an uploaded photo, in pixels
const PHOTO_QUALITY = 0.8;   // JPEG quality, 0 to 1
const TOKEN_KEY = 'githubToken';

// ---------- Small helpers ----------

const $ = (id) => document.getElementById(id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text; // textContent, never innerHTML, so text is shown as-is
  if (className) node.className = className;
  return node;
}

function showMessage(node, text, kind) {
  node.textContent = text;
  node.className = 'message' + (kind ? ' ' + kind : '');
}

// Today's date as YYYY-MM-DD in local time
function todayString() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function loadRecipeList() {
  const res = await fetch('recipes/list.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the recipe list (${res.status}).`);
  return res.json();
}

// The token lives only in this browser's local storage (which can throw in private mode).
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function setToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch {} }
function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

// ---------- GitHub API ----------

async function api(path, { method = 'GET', body, accept, token = getToken() } = {}) {
  const headers = { Accept: accept || 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method,
    headers,
    body: body && JSON.stringify(body),
    cache: 'no-store', // always get the latest bake log
  });
  if (res.status === 401 && token) {
    forgetToken();
    throw new Error('GitHub rejected the token (wrong or expired). It was removed from this browser; you will be asked for it on your next save.');
  }
  return res;
}

// Like api(), but expects success and returns the JSON reply.
async function apiJson(path, options) {
  const res = await api(path, options);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch {}
    throw new Error(`GitHub error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

// Returns the bake log file's text ('' if the recipe has no bakes yet).
async function readBakeFile(slug, ref) {
  const query = ref ? `?ref=${ref}` : '';
  const res = await api(`/contents/bakes/${slug}.md${query}`, { accept: 'application/vnd.github.raw+json' });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`Could not load the bake log (${res.status}).`);
  return res.text();
}

// ---------- Recipe and bake log formats ----------

// Recipe file: title on the first line, then a line "Ingredients" and a line "Method", each followed by its section.
function parseRecipe(text) {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const ing = lines.findIndex((l) => l.trim() === 'Ingredients');
  const met = lines.findIndex((l) => l.trim() === 'Method');
  const title = lines[0].trim();
  if (ing < 0 || met < ing) {
    // Not in the standard layout: show everything after the title, without headings
    return { title, sections: false, ingredients: lines.slice(1).join('\n').trim(), method: '' };
  }
  return {
    title,
    sections: true,
    ingredients: lines.slice(ing + 1, met).join('\n').trim(),
    method: lines.slice(met + 1).join('\n').trim(),
  };
}

// Bake log file: an optional "# Title" header, then one "## YYYY-MM-DD" section per bake.
function splitEntries(text) {
  const parts = text.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  const head = parts[0].startsWith('## ') ? '' : parts.shift();
  return { head: head.trim(), entries: parts };
}

function parseEntry(chunk) {
  const lines = chunk.trim().split('\n');
  const entry = { date: lines[0].slice(3).trim(), fields: [], photos: [] };
  let current = null;
  for (const line of lines.slice(1)) {
    const field = line.match(/^\*\*(.+?):\*\* ?(.*)$/);   // **Label:** value
    const photo = line.match(/^!\[[^\]]*\]\(([^)]+)\)\s*$/); // ![photo](../photos/...)
    if (field) {
      current = { label: field[1], value: field[2] };
      entry.fields.push(current);
    } else if (photo) {
      entry.photos.push(photo[1].replace(/^\.\.\//, '')); // make the path relative to the site root
      current = null;
    } else if (current) {
      current.value += '\n' + line; // value continues over several lines
    }
  }
  entry.fields.forEach((f) => { f.value = f.value.trim(); });
  return entry;
}

function buildEntry(date, fields, photoPaths) {
  let md = `## ${date}\n\n`;
  for (const [label, value] of fields) {
    if (value.trim()) md += `**${label}:** ${value.trim()}\n\n`;
  }
  for (const path of photoPaths) md += `![photo](../${path})\n`;
  return md;
}

// Adds a new entry and keeps the file sorted newest first (the new one goes first on a tie).
function addEntry(fileText, title, entryText) {
  const { head, entries } = splitEntries(fileText);
  const sorted = [entryText, ...entries].sort((a, b) => b.slice(3, 13).localeCompare(a.slice(3, 13)));
  return (head || `# ${title} — bake log`) + '\n\n' + sorted.map((e) => e.trim() + '\n').join('\n');
}

// ---------- Photos ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not read photo "${file.name}".`));
    img.src = URL.createObjectURL(file);
  });
}

// Shrinks a photo to MAX_PHOTO_SIZE and returns it as a JPEG data URL.
async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

// ---------- Saving a bake ----------

let pendingPhotos = [];   // photos chosen for the next bake
const localPreviews = {}; // just-saved photo path -> data URL, shown until GitHub Pages publishes the photo

// Saves the bake entry and all its photos as one commit, so it either all saves or nothing does.
async function saveBake(slug, title, form) {
  let token = getToken();
  if (!token) {
    token = (prompt('Paste your GitHub token. It is stored only in this browser.') || '').trim();
    if (!token) throw new Error('No token entered.');
    setToken(token);
  }

  const date = form.date.value;
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS, keeps file names unique
  const photos = await Promise.all(pendingPhotos.map(shrinkPhoto));
  const paths = photos.map((_, i) => `photos/${slug}/${date}-${stamp}-${i + 1}.jpg`);

  // Latest commit on the branch, and the bake log as it is in that commit
  const ref = await apiJson(`/git/ref/heads/${BRANCH}`, { token });
  const parentSha = ref.object.sha;
  const parent = await apiJson(`/git/commits/${parentSha}`, { token });
  const currentLog = await readBakeFile(slug, parentSha);

  const entry = buildEntry(date, [
    ['Changes from the recipe', form.changes.value],
    ['Flour type', form.flour.value],
    ['Times', form.times.value],
    ['Notes', form.notes.value],
  ], paths);

  const tree = [{ path: `bakes/${slug}.md`, mode: '100644', type: 'blob', content: addEntry(currentLog, title, entry) }];
  for (let i = 0; i < photos.length; i++) {
    const blob = await apiJson('/git/blobs', {
      method: 'POST', token, body: { content: photos[i].split(',')[1], encoding: 'base64' },
    });
    tree.push({ path: paths[i], mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await apiJson('/git/trees', { method: 'POST', token, body: { base_tree: parent.tree.sha, tree } });
  const commit = await apiJson('/git/commits', {
    method: 'POST', token, body: { message: `Add bake: ${title}, ${date}`, tree: newTree.sha, parents: [parentSha] },
  });
  await apiJson(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', token, body: { sha: commit.sha } });

  paths.forEach((path, i) => { localPreviews[path] = photos[i]; });
}

// ---------- Pages ----------

async function initListPage() {
  const list = $('recipe-list');
  const search = $('search');
  const message = $('list-message');

  let recipes;
  try {
    recipes = await loadRecipeList();
  } catch (e) {
    showMessage(message, e.message, 'error');
    return;
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title));

  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = recipes.filter((r) => r.title.toLowerCase().includes(query));
    list.replaceChildren(...matches.map((r) => {
      const link = el('a', r.title);
      link.href = `recipe.html?r=${encodeURIComponent(r.file)}`;
      const item = el('li');
      item.append(link);
      return item;
    }));
    showMessage(message, matches.length ? '' : 'No recipes found.');
  }

  search.addEventListener('input', render);
  render();
}

async function initRecipePage() {
  const slug = new URLSearchParams(location.search).get('r');
  let rawText, recipe;
  try {
    const list = await loadRecipeList();
    if (!list.some((r) => r.file === slug)) throw new Error('Recipe not found.');
    const res = await fetch(`recipes/${encodeURIComponent(slug)}.txt`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load the recipe (${res.status}).`);
    rawText = (await res.text()).replace(/\r\n/g, '\n').trim();
    recipe = parseRecipe(rawText);
  } catch (e) {
    showMessage($('page-message'), e.message, 'error');
    return;
  }

  document.title = recipe.title;
  $('title').textContent = recipe.title;
  $('ingredients').textContent = recipe.ingredients;
  $('method').textContent = recipe.method;
  $('ingredients-heading').hidden = !recipe.sections;
  $('method-heading').hidden = !recipe.sections;
  $('recipe').hidden = false;

  // Copy the recipe exactly as written in its file
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      showMessage($('copy-message'), 'Copied', 'ok');
    } catch {
      showMessage($('copy-message'), 'Could not copy', 'error');
    }
  });

  setUpBakeForm(slug, recipe.title);
  loadBakeLog(slug);
}

async function loadBakeLog(slug) {
  const message = $('log-message');
  showMessage(message, 'Loading bake log…');
  try {
    const bakes = splitEntries(await readBakeFile(slug)).entries.map(parseEntry);
    $('bake-log').replaceChildren(...bakes.map(renderBake));
    showMessage(message, bakes.length ? '' : 'No bakes yet.');
  } catch (e) {
    showMessage(message, e.message, 'error');
  }
}

function renderBake(bake) {
  const box = el('div', null, 'bake');
  box.append(el('h3', bake.date));
  for (const field of bake.fields) {
    const p = el('p');
    p.append(el('strong', field.label + ': '), el('span', field.value, 'text'));
    box.append(p);
  }
  for (const path of bake.photos) {
    // Photos are shown cropped to the same size; tapping opens the full photo
    const link = el('a', null, 'photo');
    link.href = path;
    link.target = '_blank';
    const img = el('img');
    img.src = localPreviews[path] || path;
    img.alt = 'Bake photo';
    img.loading = 'lazy';
    link.append(img);
    box.append(link);
  }
  return box;
}

function setUpBakeForm(slug, title) {
  const form = $('bake-form');
  const previews = $('photo-previews');
  const clearButton = $('clear-photos');
  const saveButton = form.querySelector('button[type="submit"]');
  const message = $('save-message');

  form.date.value = todayString();

  function renderPreviews() {
    previews.replaceChildren(...pendingPhotos.map((file) => {
      const img = el('img');
      img.src = URL.createObjectURL(file);
      img.alt = '';
      return img;
    }));
    clearButton.hidden = !pendingPhotos.length;
  }

  // Each pick adds to the list, so you can take several camera shots and add gallery photos too
  form.photos.addEventListener('change', () => {
    pendingPhotos.push(...form.photos.files);
    form.photos.value = '';
    renderPreviews();
  });

  clearButton.addEventListener('click', () => {
    pendingPhotos = [];
    renderPreviews();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    showMessage(message, 'Saving…');
    try {
      await saveBake(slug, title, form);
      form.reset();
      form.date.value = todayString();
      pendingPhotos = [];
      renderPreviews();
      showMessage(message, 'Saved ✓', 'ok');
      loadBakeLog(slug);
    } catch (e) {
      showMessage(message, 'Save failed: ' + e.message, 'error');
    } finally {
      saveButton.disabled = false;
    }
  });
}

const page = document.body.dataset.page;
if (page === 'list') initListPage();
if (page === 'recipe') initRecipePage();
