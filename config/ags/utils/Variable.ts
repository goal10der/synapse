export class Variable<T> {
  private value: T;
  private subscribers: Set<(value: T) => void> = new Set();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  set(newValue: T): void {
    this.value = newValue;
    this.subscribers.forEach((callback) => callback(this.value));
  }

  subscribe(callback: (value: T) => void): () => void {
    this.subscribers.add(callback);
    callback(this.value);
    return () => this.subscribers.delete(callback);
  }

  /** Explicit unsubscribe – used in Settings.tsx tab switching pattern */
  unsubscribe(callback: (value: T) => void): void {
    this.subscribers.delete(callback);
  }
}
