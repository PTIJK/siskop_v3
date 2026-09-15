import { backend, domain, cloudRequest } from './cloud.mjs';
const base = `https://firebaseapphosting.googleapis.com/v1/${backend}/domains`;
const list = await cloudRequest('GET', base);
const existing = list.domains?.find(item => item.name.endsWith('/' + domain));
if (process.argv[2] === 'create' && !existing) {
  const operation = await cloudRequest('POST', `${base}?domainId=${encodeURIComponent(domain)}`, { displayName: 'SISKOP tenant workspaces' });
  console.log(JSON.stringify({ operation: operation.name }));
} else {
  console.log(JSON.stringify(existing ?? { message: 'Wildcard domain has not been created.' }, null, 2));
}
