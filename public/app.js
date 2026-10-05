const form = document.querySelector('#task-form');
const durationInput = document.querySelector('#duration');
const submitButton = document.querySelector('#submit-button');
const statusElement = document.querySelector('#status');
const tokenContainer = document.querySelector('#token-container');
const tokenInput = document.querySelector('#token');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function setStatus(message) {
  statusElement.textContent = `Status: ${message}`;
}

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }
  return body;
}

fetch('/api/config')
  .then(readJson)
  .then((settings) => {
    tokenContainer.hidden = !settings.requiresSubmitToken;
    tokenInput.required = settings.requiresSubmitToken;
  })
  .catch(() => setStatus('Configuration unavailable'));

async function pollTask(taskId) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const task = await readJson(await fetch(`/api/tasks/${encodeURIComponent(taskId)}`));

    if (task.state === 'completed') {
      setStatus(task.result?.message || 'Completed');
      return;
    }

    if (task.state === 'failed') {
      throw new Error(task.failedReason || 'The worker failed this task');
    }

    const progress = typeof task.progress === 'number' ? ` (${task.progress}%)` : '';
    setStatus(`${task.state}${progress}`);
    await sleep(1000);
  }

  throw new Error('Timed out while waiting for the task');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setStatus('Submitting');

  try {
    const durationMs = Number(durationInput.value) * 1000;
    const token = tokenInput.value.trim();
    const task = await readJson(await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Test-Token': token } : {}),
      },
      body: JSON.stringify({ durationMs }),
    }));

    setStatus(`Queued as task ${task.id}`);
    await pollTask(task.id);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});
