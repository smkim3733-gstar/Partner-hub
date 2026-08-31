/** Reuse the prepared case and uploaded file IDs after an uncertain save response. */
export class ApplicationSubmission<T> {
  private prepared: T | null = null;
  private flight: Promise<T> | null = null;

  hasPrepared() {
    return this.prepared !== null;
  }

  submit(
    prepare: () => Promise<T>,
    persist: (value: T) => Promise<void>,
  ): Promise<T> {
    if (this.flight) return this.flight;
    this.flight = this.run(prepare, persist).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }

  private async run(
    prepare: () => Promise<T>,
    persist: (value: T) => Promise<void>,
  ) {
    if (this.prepared === null) this.prepared = await prepare();
    const result = this.prepared;
    await persist(result);
    this.prepared = null;
    return result;
  }
}
