import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { logger } from '../../utils/logger.js';

// TALKING TO LLAMACLOUD (LlamaExtract).
//
// Three calls, in order:
//
//   1. POST /api/v1/beta/files        the bill itself, multipart, purpose=extract
//   2. POST /api/v2/extract           a job: that file + the schema we want back
//   3. GET  /api/v2/extract/{id}      polled until the job leaves RUNNING
//
// WHY A SEPARATE FILE. bill-extraction.service.js owns the part that matters to
// the business - the schema, the prompt, and the rule that nothing reaches the
// books unreviewed. This file owns only the plumbing of one vendor's API, so
// swapping vendors later is a change here and nowhere else.
//
// THE API KEY NEVER LEAVES THIS PROCESS. It is read from env, used in the
// Authorization header, and appears in no response, log line or error message.

/** LlamaCloud wants a filename with a real extension; the bytes decide nothing. */
const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/**
 * The project the key belongs to, looked up once per process.
 *
 * Every LlamaCloud call is scoped to a project. An account has a default one,
 * so the operator does not have to find its id - but LLAMA_PROJECT_ID overrides
 * this for an account with several.
 */
let cachedProjectId = null;

function baseUrl() {
  return env.LLAMA_BASE_URL.replace(/\/+$/, '');
}

function authHeaders() {
  return { Authorization: `Bearer ${env.LLAMA_API_KEY}` };
}

/** Milliseconds left of the overall budget, or a failure if it is spent. */
function remaining(deadline) {
  const left = deadline - Date.now();
  if (left <= 0) {
    throw ApiError.business(
      504,
      'EXTRACTION_TIMEOUT',
      'Reading the bill took too long. Try again, or enter it manually.',
    );
  }
  return left;
}

/**
 * One HTTP call, with the vendor's failures mapped to this project's errors.
 *
 * The response body is logged (truncated) and never returned to the caller:
 * some vendors echo the request - including its Authorization header - back in
 * an error, and that must not reach a browser.
 */
async function request(url, { method = 'GET', headers = {}, body, deadline, label }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...authHeaders(), ...headers },
      body,
      signal: AbortSignal.timeout(remaining(deadline)),
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw ApiError.business(
        504,
        'EXTRACTION_TIMEOUT',
        'Reading the bill took too long. Try again, or enter it manually.',
      );
    }

    logger.error({ label, err: error.message }, 'LlamaCloud request failed');
    throw ApiError.business(
      502,
      'EXTRACTION_UNAVAILABLE',
      'The bill reading service could not be reached. Try again, or enter it manually.',
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error({ label, status: response.status, body: text.slice(0, 500) }, 'LlamaCloud returned an error');

    if (response.status === 429) {
      throw ApiError.business(
        429,
        'EXTRACTION_RATE_LIMITED',
        'The bill reading service is busy. Wait a moment and try again.',
      );
    }

    // 401/403 is the operator's key, not the shop's bill. Say so plainly rather
    // than blaming the photograph.
    if (response.status === 401 || response.status === 403) {
      throw ApiError.business(
        503,
        'EXTRACTION_NOT_CONFIGURED',
        'Automatic bill reading is not set up correctly on this server. Enter the bill manually for now.',
      );
    }

    throw ApiError.business(
      502,
      'EXTRACTION_FAILED',
      'The bill could not be read automatically. Enter it manually, or try another photo.',
    );
  }

  return response.json().catch(() => null);
}

/** The project to work in: configured, else the account's default. */
async function resolveProjectId(deadline) {
  if (env.LLAMA_PROJECT_ID) return env.LLAMA_PROJECT_ID;
  if (cachedProjectId) return cachedProjectId;

  const projects = await request(`${baseUrl()}/api/v1/projects`, {
    deadline,
    label: 'projects',
  });

  const list = Array.isArray(projects) ? projects : (projects?.projects ?? []);
  const chosen = list.find((project) => project?.is_default) ?? list[0];

  if (!chosen?.id) {
    logger.error({ count: list.length }, 'LlamaCloud returned no usable project');
    throw ApiError.business(
      503,
      'EXTRACTION_NOT_CONFIGURED',
      'Automatic bill reading is not set up correctly on this server. Enter the bill manually for now.',
    );
  }

  cachedProjectId = chosen.id;
  return cachedProjectId;
}

/** Uploads the bill and returns the id the extraction job will refer to. */
async function uploadFile(fileBuffer, mimeType, deadline) {
  const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
  const form = new FormData();
  // The name is a label for the vendor's UI. The shop's own filename is not sent:
  // it is the one piece of this that a customer chose, and it has no job here.
  form.append('file', new Blob([fileBuffer], { type: mimeType }), `bill.${extension}`);
  form.append('purpose', 'extract');

  const uploaded = await request(`${baseUrl()}/api/v1/beta/files`, {
    method: 'POST',
    body: form,
    deadline,
    label: 'upload',
  });

  if (!uploaded?.id) {
    logger.error('LlamaCloud upload returned no file id');
    throw ApiError.business(
      502,
      'EXTRACTION_FAILED',
      'The bill could not be read automatically. Enter it manually, or try another photo.',
    );
  }

  return uploaded.id;
}

/** Statuses that mean the job is still working. Anything else ends the wait. */
const IN_FLIGHT = new Set(['PENDING', 'RUNNING', 'IN_PROGRESS', 'QUEUED', 'CREATED']);

/**
 * Runs one extraction job to completion.
 *
 * @param {Buffer} fileBuffer
 * @param {string} mimeType
 * @param {{ jsonSchema: object, systemPrompt: string }} options
 * @returns {Promise<{ result: unknown, model: string }>}
 */
export async function extractWithLlamaCloud(fileBuffer, mimeType, { jsonSchema, systemPrompt }) {
  const deadline = Date.now() + env.LLAMA_TIMEOUT_MS;

  const projectId = await resolveProjectId(deadline);
  const fileId = await uploadFile(fileBuffer, mimeType, deadline);

  const job = await request(`${baseUrl()}/api/v2/extract?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_input: fileId,
      configuration: {
        tier: env.LLAMA_EXTRACT_TIER,
        version: 'latest',
        extraction_target: 'per_doc',
        data_schema: jsonSchema,
        system_prompt: systemPrompt,
      },
    }),
    deadline,
    label: 'create-job',
  });

  if (!job?.id) {
    logger.error('LlamaCloud extract returned no job id');
    throw ApiError.business(
      502,
      'EXTRACTION_FAILED',
      'The bill could not be read automatically. Enter it manually, or try another photo.',
    );
  }

  const jobUrl = `${baseUrl()}/api/v2/extract/${encodeURIComponent(job.id)}?project_id=${encodeURIComponent(projectId)}`;

  // Polling, because the vendor has no callback. The wait between polls is short
  // at first - a small printed bill finishes in seconds - and the overall budget
  // is LLAMA_TIMEOUT_MS, enforced by remaining().
  for (let attempt = 0; ; attempt += 1) {
    const wait = Math.min(1000 + attempt * 500, 4000);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, remaining(deadline))));

    const polled = await request(jobUrl, { deadline, label: 'poll' });
    const status = polled?.status ?? polled?.job?.status;

    if (status && !IN_FLIGHT.has(status)) {
      if (status !== 'COMPLETED' && status !== 'SUCCESS') {
        logger.error(
          { status, error: String(polled?.error_message ?? '').slice(0, 300) },
          'LlamaCloud extraction job did not complete',
        );
        throw ApiError.business(
          502,
          'EXTRACTION_FAILED',
          'The bill could not be read automatically. Enter it manually, or try another photo.',
        );
      }

      return {
        result: polled?.extract_result ?? polled?.job?.extract_result ?? null,
        // Recorded on the bill for audit: which service and setting read it.
        model: `llamacloud/extract/${polled?.configuration?.tier ?? env.LLAMA_EXTRACT_TIER}`,
      };
    }
  }
}
