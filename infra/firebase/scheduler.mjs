import { readFileSync } from 'node:fs';

export const project = 'siskop-d0f8c';
export const region = 'asia-southeast2';
export const service = 'siskop-staging-api';
export const invoker = `siskop-scheduler-invoker@${project}.iam.gserviceaccount.com`;
export const jobs = JSON.parse(readFileSync(new URL('./scheduler-jobs.json', import.meta.url), 'utf8'));
const jobsUrl = `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs`;

export async function optionalResource(cloud, url) {
  try { return await cloud.request('GET', url); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

export async function prepareJobs(cloud, origin, token) {
  if (!/^https:\/\/siskop-staging-api-[a-z0-9-]+\.a\.run\.app$/.test(origin)) throw new Error('Unexpected API origin');
  if (!token || /[\r\n]/.test(token)) throw new Error('Invalid scheduler credential');
  for (const spec of jobs) {
    const name = `projects/${project}/locations/${region}/jobs/${spec.id}`;
    const url = `${jobsUrl}/${spec.id}`;
    const definition = {
      name, description: spec.description, schedule: spec.schedule, timeZone: spec.timeZone,
      // Runtime allows 300s. Allow extra time for cold starts and network transit.
      attemptDeadline: '330s',
      retryConfig: { retryCount: 3, minBackoffDuration: '60s', maxBackoffDuration: '300s', maxDoublings: 2, maxRetryDuration: '0s' },
      httpTarget: { uri: origin + spec.path, httpMethod: 'POST', headers: { 'x-scheduler-token': token }, oidcToken: { serviceAccountEmail: invoker, audience: origin } }
    };
    let job = await optionalResource(cloud, url);
    if (!job) {
      // Create has no paused flag. Start with a harmless GET, pause it, THEN
      // install the POST target. Even interruption here cannot execute work.
      job = await cloud.request('POST', jobsUrl, { ...definition, httpTarget: { ...definition.httpTarget, uri: origin + '/api/scheduler/status', httpMethod: 'GET' } });
    }
    if (job.state === 'ENABLED') job = await cloud.request('POST', url + ':pause', {});
    if (job.state !== 'PAUSED') throw new Error(`${spec.id} must be paused before configuration`);
    await cloud.request('PATCH', url + '?updateMask=description,schedule,timeZone,attemptDeadline,retryConfig,httpTarget', definition);
  }
}
