export interface ToneSnapshot {
  state: AudioContextState;
  active: boolean;
}

interface ToneSession {
  context: AudioContext;
  oscillator?: OscillatorNode;
  gain?: GainNode;
  cancelTimer: () => void;
  stateChanged: () => void;
  stopping: boolean;
}

export function createToneSample({
  createContext,
  onChange,
  onError,
  schedule = (callback) => {
    const timer = setTimeout(callback, 5000);
    return () => clearTimeout(timer);
  },
}: {
  createContext: () => AudioContext;
  onChange: (snapshot: ToneSnapshot) => void;
  onError: (error: unknown) => void;
  schedule?: (callback: () => void) => () => void;
}) {
  let current: ToneSession | null = null;

  function stop() {
    const sample = current;
    if (!sample || sample.stopping) {
      return;
    }
    sample.stopping = true;
    sample.cancelTimer();
    sample.context.removeEventListener("statechange", sample.stateChanged);
    try {
      sample.oscillator?.stop();
    } catch {}
    try {
      sample.oscillator?.disconnect();
    } catch {}
    try {
      sample.gain?.disconnect();
    } catch {}
    const finished = () => {
      if (current === sample) {
        current = null;
        onChange({ state: sample.context.state, active: false });
      }
    };
    try {
      void sample.context.close().catch(onError).finally(finished);
    } catch (failure) {
      onError(failure);
      finished();
    }
  }

  return {
    play() {
      if (current) {
        return;
      }
      const context = createContext();
      const sample: ToneSession = {
        context,
        cancelTimer: () => {},
        stateChanged: () => {
          if (current === sample && !sample.stopping) {
            onChange({ state: context.state, active: true });
          }
        },
        stopping: false,
      };
      current = sample;
      try {
        sample.oscillator = context.createOscillator();
        sample.gain = context.createGain();
        sample.oscillator.frequency.value = 440;
        sample.gain.gain.value = 0.025;
        sample.oscillator.connect(sample.gain);
        sample.gain.connect(context.destination);
        sample.oscillator.start();
        sample.oscillator.stop(context.currentTime + 5);
        context.addEventListener("statechange", sample.stateChanged);
        sample.cancelTimer = schedule(stop);
        const resumed = context.resume();
        sample.stateChanged();
        void resumed.then(sample.stateChanged).catch((failure) => {
          if (current === sample && !sample.stopping) {
            onError(failure);
            stop();
          }
        });
      } catch (failure) {
        onError(failure);
        stop();
      }
    },
    stop,
  };
}
