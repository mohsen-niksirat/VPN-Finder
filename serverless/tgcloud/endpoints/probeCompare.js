import { runDebugProbe } from '../lib/probe.js';

export default async function () {
  const res = await runDebugProbe('endpoint');
  return res.record;
}
