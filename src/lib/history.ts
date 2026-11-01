/** Undo and redo over whole-state snapshots. Callers store compact snapshots (run-length encoded labels). */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly limit = 50) {}

  /** Record the state from before an edit. */
  push(state: T) {
    this.undoStack.push(state);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  clearRedo() {
    this.redoStack = [];
  }

  /** Forget the most recent `push`, for an edit that turned out to change nothing. */
  dropLast() {
    this.undoStack.pop();
  }

  undo(current: T): T | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
