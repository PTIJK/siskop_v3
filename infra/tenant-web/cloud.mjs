import { execFileSync } from 'node:child_process';

export const project = 'siskop-d0f8c';
export const backend = `projects/${project}/locations/asia-southeast1/backends/siskop-tenants`;
export const domain = '*.koperasi.inovasijayakarsa.id';
export function cloudToken() {
  return execFileSync(process.env.GCLOUD_BIN ?? 'gcloud', ['auth', 'print-access-token', '--account=yudith.octo@gmail.com', `--project=${project}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}
export async function cloudRequest(method, url, data) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${cloudToken()}`, 'Content-Type': 'application/json', 'x-goog-user-project': project }, ...(data ? { body: JSON.stringify(data) } : {}) });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`Cloud API HTTP ${response.status} returned non-JSON at ${new URL(url).pathname}`); }
  if (!response.ok) { const error = new Error(`Cloud API HTTP ${response.status}: ${result.error?.message ?? 'Request failed'}`); error.status = response.status; throw error; }
  return result;
}
