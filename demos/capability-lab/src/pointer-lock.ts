export interface PointerLockSnapshot {
  phase: "idle" | "requesting" | "locked" | "exiting" | "failed";
  movementX: number;
  movementY: number;
  totalX: number;
  totalY: number;
}

export function createPointerLockSample({
  request,
  exit,
  isLocked,
  onChange,
  onError,
}: {
  request: () => void | Promise<void>;
  exit: () => void;
  isLocked: () => boolean;
  onChange: (snapshot: PointerLockSnapshot) => void;
  onError: (failure: unknown) => void;
}) {
  let pending: { failure?: unknown } | null = null;
  let wanted = false;
  let disposed = false;
  let snapshot: PointerLockSnapshot = {
    phase: "idle",
    movementX: 0,
    movementY: 0,
    totalX: 0,
    totalY: 0,
  };
  const notify = () => onChange({ ...snapshot });
  function failed(failure: unknown) {
    if (!pending) {
      return;
    }
    const cancelled = !wanted || disposed;
    const reason = pending.failure ?? failure;
    pending = null;
    wanted = false;
    snapshot.phase = cancelled ? "idle" : "failed";
    notify();
    if (!cancelled) {
      onError(reason);
    }
  }
  function release() {
    wanted = false;
    const locked = isLocked();
    snapshot = {
      phase: locked || pending ? "exiting" : "idle",
      movementX: 0,
      movementY: 0,
      totalX: 0,
      totalY: 0,
    };
    notify();
    if (locked) {
      try {
        exit();
      } catch (failure) {
        snapshot.phase = "locked";
        notify();
        onError(failure);
      }
    }
  }
  return {
    request() {
      if (
        disposed ||
        pending ||
        ["requesting", "exiting"].includes(snapshot.phase) ||
        isLocked()
      ) {
        return;
      }
      wanted = true;
      const attempt: { failure?: unknown } = {};
      pending = attempt;
      snapshot = {
        phase: "requesting",
        movementX: 0,
        movementY: 0,
        totalX: 0,
        totalY: 0,
      };
      notify();
      try {
        const result = request();
        if (result) {
          // Native events have no request ID; wait for them before permitting another request.
          void result.catch((failure) => {
            if (pending === attempt) {
              attempt.failure = failure;
            }
          });
        }
      } catch (failure) {
        failed(failure);
      }
    },
    changed() {
      if (isLocked()) {
        pending = null;
        if (!wanted || disposed) {
          release();
          return;
        }
        snapshot.phase = "locked";
        notify();
      } else if (["locked", "exiting"].includes(snapshot.phase)) {
        pending = null;
        release();
      }
    },
    failed,
    move(movementX: number, movementY: number) {
      if (
        disposed ||
        snapshot.phase !== "locked" ||
        !isLocked() ||
        !Number.isFinite(movementX) ||
        !Number.isFinite(movementY)
      ) {
        return;
      }
      snapshot.movementX = movementX;
      snapshot.movementY = movementY;
      snapshot.totalX += movementX;
      snapshot.totalY += movementY;
      notify();
    },
    release,
    dispose() {
      disposed = true;
      release();
    },
  };
}
