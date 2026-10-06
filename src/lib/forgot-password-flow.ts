/** Keep the visible mail result tied to the latest, unchanged email input. */
export function createForgotPasswordFlow(callbacks: {
  onState: (state: { submitting: boolean; sent: boolean }) => void;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}) {
  let revision = 0;
  let pending = false;
  const invalidate = () => { revision += 1; pending = false; };
  return {
    // Cleanup must not dispatch React state updates.
    invalidate,
    reset() {
      invalidate();
      callbacks.onState({ submitting: false, sent: false });
    },
    async submit(email: string, send: (email: string) => Promise<unknown>) {
      if (pending) return;
      const current = ++revision;
      pending = true;
      callbacks.onState({ submitting: true, sent: false });
      try {
        await send(email);
        if (current !== revision) return;
        pending = false;
        callbacks.onState({ submitting: false, sent: true });
        callbacks.onSuccess();
      } catch (error) {
        if (current !== revision) return;
        pending = false;
        callbacks.onState({ submitting: false, sent: false });
        callbacks.onError(error);
      }
    },
  };
}
