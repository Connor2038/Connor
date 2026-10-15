import type { Product, Step, ProductPlaylist } from './types';
export interface RundownState {
  productIndex: number;
  stepIndex: number;
  cycle: number;
  pendingProductId?: string;
  status: 'idle' | 'running' | 'paused' | 'failed' | 'completed';
  occurrenceId?: string;
}
export class Rundown {
  private controller: AbortController | null = null;
  private state: RundownState = { productIndex: 0, stepIndex: 0, cycle: 1, status: 'idle' };
  private pendingProduct: number | null = null;
  private occurrence = 0;
  private execution: Promise<void> | null = null;
  constructor(
    private products: Product[],
    private execute: (step: Step, signal: AbortSignal) => Promise<void>,
    private changed: (state: RundownState) => void,
    private failed: (error: Error) => void,
    private playlist?: ProductPlaylist,
    private prepareProduct?: (product: Product, signal: AbortSignal) => Promise<void>,
  ) {
    this.selectOccurrence(0);
  }
  private selectOccurrence(index: number) {
    this.occurrence = index;
    const item = this.playlist?.items[index];
    if (item) {
      this.state.productIndex = this.products.findIndex(
        (product) => product.id === item.product_id,
      );
      if (this.state.productIndex < 0)
        throw new Error(`Unknown playlist product: ${item.product_id}`);
    }
  }
  private selectProduct(index: number) {
    this.state.productIndex = index;
    this.state.stepIndex = 0;
    const occurrence = this.playlist?.items.findIndex(
      (item) => item.product_id === this.products[index].id,
    );
    if (occurrence !== undefined && occurrence >= 0) this.occurrence = occurrence;
  }
  start() {
    if (
      !this.products.length ||
      this.state.status === 'running' ||
      (this.playlist && !this.playlist.items.length)
    )
      return;
    if (this.state.status === 'completed') {
      this.selectOccurrence(0);
      this.state.stepIndex = 0;
    }
    this.state.status = 'running';
    const controller = new AbortController();
    this.controller = controller;
    this.emit();
    this.execution = this.run(controller);
  }
  pause() {
    if (this.state.status !== 'running') return;
    this.state.status = 'paused';
    this.controller?.abort();
    this.emit();
  }
  async resume() {
    await this.execution;
    if (
      this.state.status === 'paused' ||
      (this.state.status === 'idle' && this.pendingProduct !== null)
    )
      this.start();
  }
  switchTo(id: string) {
    const index = this.products.findIndex((p) => p.id === id);
    if (index < 0) throw new Error('Unknown product.');
    // Selecting the current item keeps its cursor, including after a spoken question.
    if (index === this.state.productIndex && this.pendingProduct === null) {
      this.pendingProduct = null;
      this.emit();
      return;
    }
    this.pendingProduct = index;
    if (this.state.status === 'completed') this.state.status = 'idle';
    this.emit();
    if (this.state.status === 'running' && this.playlist?.manual_switch_policy === 'immediate') {
      this.pause();
      void this.resume();
    }
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    this.state = { productIndex: 0, stepIndex: 0, cycle: 1, status: 'idle' };
    this.pendingProduct = null;
    this.selectOccurrence(0);
    this.emit();
  }
  snapshot() {
    return {
      ...this.state,
      occurrenceId: this.playlist?.items[this.occurrence]?.occurrence_id,
      pendingProductId:
        this.pendingProduct === null ? undefined : this.products[this.pendingProduct].id,
    };
  }
  private emit() {
    this.changed(this.snapshot());
  }
  private async run(controller: AbortController) {
    try {
      while (!controller.signal.aborted) {
        if (this.pendingProduct !== null) {
          const index = this.pendingProduct;
          await this.prepareProduct?.(this.products[index], controller.signal);
          if (controller.signal.aborted) return;
          // A newer click supersedes a scene update still awaiting its ACK.
          if (this.pendingProduct !== index) continue;
          this.selectProduct(index);
          this.pendingProduct = null;
          this.emit();
        }
        const product = this.products[this.state.productIndex];
        await this.execute(product.steps[this.state.stepIndex], controller.signal);
        if (controller.signal.aborted) return;
        if (this.pendingProduct !== null) continue;
        if (++this.state.stepIndex >= product.steps.length) {
          if (this.playlist?.auto_advance === false && this.pendingProduct === null) {
            this.state.stepIndex = product.steps.length - 1;
            this.state.status = 'paused';
            this.emit();
            return;
          }
          this.state.stepIndex = 0;
          if (this.playlist) {
            const next = this.occurrence + 1;
            if (next >= this.playlist.items.length && !this.playlist.loop_after_completion) {
              this.state.stepIndex = product.steps.length - 1;
              this.state.status = 'completed';
              this.emit();
              return;
            }
            if (next >= this.playlist.items.length) this.state.cycle++;
            this.selectOccurrence(next % this.playlist.items.length);
          } else if (++this.state.productIndex >= this.products.length) {
            this.state.productIndex = 0;
            this.state.cycle++;
          }
        }
        this.emit();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.state.status = 'failed';
        this.emit();
        this.failed(error instanceof Error ? error : new Error('Rundown failed.'));
      }
    }
  }
}
