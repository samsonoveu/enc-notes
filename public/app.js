import { decryptText, encryptText } from '/crypto.js';

/* ------------------------------------------------------------------ helpers */
const $ = (id) => document.getElementById(id);

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

let toastTimer;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`/api/notes${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message ?? `Ошибка запроса (${response.status})`;
    throw new Error(message);
  }

  return payload?.data ?? null;
}

/* --------------------------------------------------------------- passphrase */
/** Close the password prompt if it happens to be open. */
function closePassDialog() {
  const dialog = $('pass-dialog');

  if (dialog?.open) {
    dialog.close();
  }
}

/**
 * Ask for a password. `confirm` is used when encrypting, so a typo cannot lock
 * the user out of their own note.
 *
 * The dialog is opened synchronously, before the caller awaits anything:
 * Safari refuses `showModal()` once the originating user gesture has been
 * consumed by an `await`, and the prompt then silently never appears.
 */
function askPassword({ title, hint, submitLabel, confirm = false }) {
  const dialog = $('pass-dialog');
  const form = $('pass-form');
  const input = $('pass-input');
  const error = $('pass-error');
  const confirmInput = $('pass-confirm');
  const confirmField = $('pass-confirm-field');

  $('pass-title').textContent = title;
  $('pass-hint').textContent = hint;
  $('pass-submit').textContent = submitLabel;
  confirmField.hidden = !confirm;
  // Keep the hidden field out of the tab order, so tabbing never lands on it.
  confirmInput.disabled = !confirm;

  input.value = '';
  confirmInput.value = '';
  error.hidden = true;
  error.textContent = '';

  return new Promise((resolve) => {
    // `showModal()` throws if the dialog is somehow already open, and older
    // WebKit builds can reject it outright; either way the promise must settle.
    try {
      if (!dialog.open) {
        dialog.showModal();
      }
    } catch (cause) {
      resolve(null);
      throw cause;
    }

    input.focus();

    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      $('pass-cancel').removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
    };

    const finish = (value) => {
      cleanup();

      if (dialog.open) {
        dialog.close();
      }

      resolve(value);
    };

    const onSubmit = (event) => {
      event.preventDefault();
      const value = input.value;

      if (value.length === 0) {
        error.textContent = 'Введите пароль';
        error.hidden = false;
        return;
      }

      if (confirm && value !== confirmInput.value) {
        error.textContent = 'Пароли не совпадают';
        error.hidden = false;
        return;
      }

      finish(value);
    };

    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };

    form.addEventListener('submit', onSubmit);
    $('pass-cancel').addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
  });
}

/* -------------------------------------------------------------- navigation */
const views = { list: $('view-list'), read: $('view-read'), edit: $('view-edit') };

function showView(name) {
  for (const [key, node] of Object.entries(views)) {
    node.hidden = key !== name;
  }

  // The list is the root screen, so there is nowhere to go back to; each inner
  // screen has its own close/cancel control as well.
  $('back-btn').hidden = true;
  $('new-btn').hidden = name !== 'list';
  $('brand').textContent =
    name === 'list' ? 'Заметки' : name === 'read' ? 'Заметка' : 'Редактирование';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* -------------------------------------------------------------------- state */
const state = {
  notes: [],
  /** The note currently open in the reader, including its ciphertext. */
  current: null,
  /** Password used to open `current`, reused when saving without re-prompting. */
  currentPassword: null,
};

/* --------------------------------------------------------------------- list */
function renderList() {
  const list = $('note-list');
  list.replaceChildren();
  $('list-empty').hidden = state.notes.length > 0;

  state.notes.forEach((note, index) => {
    const item = document.createElement('li');
    item.className = 'note-card';
    item.style.animationDelay = `${Math.min(index * 35, 300)}ms`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-open';

    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = note.title;

    const foot = document.createElement('span');
    foot.className = 'note-foot';
    foot.innerHTML =
      '<svg class="lock" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

    const stamp = document.createElement('span');
    stamp.textContent = formatDate(note.updatedAt);
    foot.append(stamp);

    button.append(title, foot);
    button.addEventListener('click', () => void openNote(note.id));
    item.append(button);
    list.append(item);
  });
}

async function loadList() {
  try {
    state.notes = (await api('')) ?? [];
    renderList();
  } catch (error) {
    toast(error.message);
  }
}

/* -------------------------------------------------------------------- read */
/**
 * Fetch a note and ask for its password.
 *
 * The prompt opens first, in the same task as the click, because Safari drops
 * the user-gesture context across an `await`.
 */
async function openNote(id) {
  const prompt = askPassword({
    title: 'Заметка',
    hint: 'Введите пароль, чтобы расшифровать текст заметки.',
    submitLabel: 'Открыть',
  });

  let note;
  let password;

  try {
    [note, password] = await Promise.all([api(`/${id}`), prompt]);
  } catch (error) {
    closePassDialog();
    toast(error.message);
    await loadList();
    return;
  }

  if (password === null || note === null) {
    return;
  }

  try {
    const text = await decryptText(note, password);

    state.current = note;
    state.currentPassword = password;

    $('read-title').textContent = note.title;
    $('read-meta').textContent = `Изменено ${formatDate(note.updatedAt)}`;
    $('read-body').textContent = text;

    showView('read');
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------------- write */
async function openEditor({ note, text }) {
  $('edit-title').value = note ? note.title : '';
  $('edit-body').value = text ?? '';
  $('edit-delete').hidden = !note;

  showView('edit');
  $('edit-title').focus();
}

async function saveNote() {
  const title = $('edit-title').value.trim();
  const body = $('edit-body').value;

  if (title.length === 0) {
    toast('Введите заголовок');
    $('edit-title').focus();
    return;
  }

  const button = $('edit-save');
  const isNew = state.current === null;

  // Reuse the password the note was already unlocked with, so editing does not
  // ask twice; only prompt when creating or when the session lost the password.
  // The prompt is opened before any `await` so Safari keeps the gesture context.
  let password = state.currentPassword;
  let prompt = null;

  if (password === null) {
    prompt = askPassword({
      title: isNew ? 'Новая заметка' : 'Сохранение',
      hint: 'Этим паролем текст будет зашифрован. Запомните его — восстановить его нельзя.',
      submitLabel: 'Зашифровать и сохранить',
      confirm: true,
    });

    password = await prompt;

    if (password === null) {
      return;
    }
  }

  button.disabled = true;

  try {
    const payload = await encryptText(body, password);
    const saved = isNew
      ? await api('', { method: 'POST', body: JSON.stringify({ title, ...payload }) })
      : await api(`/${state.current.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title, ...payload }),
        });

    state.current = null;
    state.currentPassword = null;

    toast(isNew ? 'Заметка создана' : 'Заметка сохранена');
    await loadList();
    showView('list');

    if (saved) {
      void saved;
    }
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function deleteNote() {
  if (state.current === null) {
    return;
  }

  if (!window.confirm('Удалить заметку без возможности восстановления?')) {
    return;
  }

  try {
    await api(`/${state.current.id}`, { method: 'DELETE' });
    state.current = null;
    state.currentPassword = null;
    toast('Заметка удалена');
    await loadList();
    showView('list');
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------------ events */
$('new-btn').addEventListener('click', () => {
  state.current = null;
  state.currentPassword = null;
  void openEditor({ note: null, text: '' });
});

$('back-btn').addEventListener('click', () => {
  state.current = null;
  state.currentPassword = null;
  showView('list');
});

$('read-close').addEventListener('click', () => {
  state.current = null;
  state.currentPassword = null;
  showView('list');
});

$('read-edit').addEventListener('click', () => {
  if (state.current === null) {
    return;
  }

  void openEditor({ note: state.current, text: $('read-body').textContent ?? '' });
});

$('edit-save').addEventListener('click', () => void saveNote());
$('edit-delete').addEventListener('click', () => void deleteNote());

$('edit-cancel').addEventListener('click', () => {
  state.current = null;
  state.currentPassword = null;
  showView('list');
});

// Ctrl/Cmd+S saves without leaving the keyboard.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    if (!views.edit.hidden) {
      event.preventDefault();
      void saveNote();
    }
  }

  if (event.key === 'Escape' && !views.edit.hidden) {
    state.current = null;
    state.currentPassword = null;
    showView('list');
  }
});

/* -------------------------------------------------------------------- boot */
showView('list');
void loadList();
