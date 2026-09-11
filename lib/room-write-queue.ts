import { RoomError } from './room-engine';

// This only prevents redundant CAS retries inside one isolate. SQLite remains
// authoritative across isolates and processes; no cached write is acknowledged.
export class RoomWriteQueue {
  private tails = new Map<string, Promise<unknown>>();
  private counts = new Map<string, number>();
  private total = 0;
  private perRoom:number;
  private maximum:number;
  constructor(perRoom = 32, maximum = 256) {this.perRoom=perRoom;this.maximum=maximum;}
  async run<T>(id: string, task: () => Promise<T>): Promise<T> {
    if ((this.counts.get(id) || 0) >= this.perRoom || this.total >= this.maximum)
      throw new RoomError('房间正在同步，请稍后重试', 503);
    const previous = this.tails.get(id) || Promise.resolve();
    this.total++;
    this.counts.set(id, (this.counts.get(id) || 0) + 1);
    const running = previous.catch(() => {}).then(task);
    this.tails.set(id, running);
    try { return await running; }
    finally {
      this.total--;
      const count = (this.counts.get(id) || 1) - 1;
      if (count) this.counts.set(id, count); else this.counts.delete(id);
      if (this.tails.get(id) === running) this.tails.delete(id);
    }
  }
}
