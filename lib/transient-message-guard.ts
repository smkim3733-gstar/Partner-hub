/** Keeps only the newest delayed message callback active. */
export class TransientMessageGuard {
  private version = 0;

  next(callback: () => void) {
    const version = ++this.version;
    return () => {
      if (version !== this.version) return false;
      this.version += 1;
      callback();
      return true;
    };
  }

  cancel() {
    this.version += 1;
  }
}
