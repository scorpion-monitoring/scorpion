// Keeps a tile's body alive while the grid around it is rebuilt. A change of mode (or of viewport) remounts the grid
// (ADR-0042, Decision 2, wrapper 3); a widget that was drawn inside a tile would be created again and read its data
// again. Instead each body is drawn once, in a parking element that is not part of the remounted tree, and the tile
// that currently shows it adopts its element. Moving an element does not restart what is in it.
//
// No Svelte and no DOM types beyond `appendChild`, so it is tested with plain objects.

export interface HostNode<N> {
  parentNode: unknown;
  appendChild: (child: N) => unknown;
}

export class BodyHost<N extends HostNode<N>> {
  readonly #stages = new Map<string, N>();
  readonly #slots = new Map<string, N>();
  #home: N | undefined;

  #sync(id: string) {
    const stage = this.#stages.get(id);
    if (!stage) return;
    const target = this.#slots.get(id) ?? this.#home;
    if (target && stage.parentNode !== target) target.appendChild(stage);
  }

  /** The parking element: where a body waits while no tile shows it. */
  home(node: N): () => void {
    this.#home = node;
    return () => {
      if (this.#home === node) this.#home = undefined;
    };
  }

  /** The element that holds the body of tile `id` (drawn once, inside the parking element). */
  stage(id: string, node: N): () => void {
    this.#stages.set(id, node);
    this.#sync(id);
    return () => {
      if (this.#stages.get(id) === node) this.#stages.delete(id);
    };
  }

  /** The place in a tile where the body of `id` is shown. When the tile goes away the body goes back to the parking element. */
  slot(id: string, node: N): () => void {
    this.#slots.set(id, node);
    this.#sync(id);
    return () => {
      // A newer slot for the same tile (a remount that attached first) keeps the body.
      if (this.#slots.get(id) !== node) return;
      this.#slots.delete(id);
      const stage = this.#stages.get(id);
      if (stage && stage.parentNode === node && this.#home) this.#home.appendChild(stage);
    };
  }
}
