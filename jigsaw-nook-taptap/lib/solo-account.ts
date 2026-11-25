import { currentAccount } from './account-store';
import { RoomError } from './room-engine';
import { SOLO_LOGIN_REQUIRED } from './account-return';

export async function requireSoloAccount(request: Request) {
  const account = await currentAccount(request);
  if (!account) throw new RoomError(SOLO_LOGIN_REQUIRED, 401);
  return account;
}
