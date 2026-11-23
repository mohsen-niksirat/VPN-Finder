import { recordServerVote, requireTelegramAuth } from '../lib/pvl.js';

export default async function (input, ctx) {
  const user = requireTelegramAuth(ctx);
  const vote = input?.vote === 'down' ? 'down' : 'up';
  return await recordServerVote(input?.id, user.id, vote);
}
