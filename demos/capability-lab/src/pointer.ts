export type PointerStatus =
  | "pointerIdle"
  | "pointerInside"
  | "pointerOutside"
  | "pointerReleased"
  | "pointerCancelled"
  | "pointerCaptureLost"
  | "pointerBlurred"
  | "pointerHidden";

export interface PointerSnapshot {
  active: boolean;
  status: PointerStatus;
}

export function createPointerSample({
  capture,
  release,
  play,
  stop,
  onChange,
  onError,
}: {
  capture: (pointerId: number) => void;
  release: (pointerId: number) => void;
  play: () => Promise<{ handle: string } | null>;
  stop: (handle: string) => Promise<unknown>;
  onChange: (snapshot: PointerSnapshot) => void;
  onError: (error: unknown) => void;
}) {
  let active: { pointerId: number; handle?: string } | null = null;
  const stopSound = (handle: string) => {
    void stop(handle).catch(onError);
  };
  return {
    begin(pointerId: number) {
      if (active) {
        return;
      }
      const press: { pointerId: number; handle?: string } = { pointerId };
      active = press;
      try {
        capture(pointerId);
      } catch (error) {
        active = null;
        onChange({ active: false, status: "pointerIdle" });
        onError(error);
        return;
      }
      onChange({ active: true, status: "pointerInside" });
      try {
        void play()
          .then((value) => {
            if (!value) {
              return;
            }
            if (active === press) {
              press.handle = value.handle;
            } else {
              stopSound(value.handle);
            }
          })
          .catch(onError);
      } catch (error) {
        onError(error);
      }
    },
    move(pointerId: number, outside: boolean) {
      if (active?.pointerId === pointerId) {
        onChange({
          active: true,
          status: outside ? "pointerOutside" : "pointerInside",
        });
      }
    },
    finish(status: PointerStatus, pointerId?: number) {
      if (
        !active ||
        (pointerId !== undefined && active.pointerId !== pointerId)
      ) {
        return;
      }
      const press = active;
      active = null;
      onChange({ active: false, status });
      try {
        release(press.pointerId);
      } catch (error) {
        onError(error);
      }
      if (press.handle) {
        stopSound(press.handle);
      }
    },
  };
}
