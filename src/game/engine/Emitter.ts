export class Emitter<T> {
  private subs = new Set<(e: T) => void>();
  on(fn: (e: T) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(e: T): void {
    for (const fn of this.subs) fn(e);
  }
}
