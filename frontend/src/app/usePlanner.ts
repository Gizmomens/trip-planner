import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import type { Bootstrap, ErrorDetail, Trip, TripInput } from '../types';

export function usePlanner() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [bootLoading, setBootLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorDetail | null>(null);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const version = useRef(0);
  const submitting = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBootLoading(true);
    setBootstrapError('');
    api
      .bootstrap(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setBootstrap(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setBootstrapError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBootLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(
    () => () => {
      version.current++;
      request.current?.abort();
    },
    [],
  );

  const invalidate = useCallback(() => {
    version.current++;
    request.current?.abort();
    submitting.current = false;
    setBusy(false);
    setTrip(null);
    setError(null);
  }, []);

  function edit() {
    if (trip || busy)
      setNotice('Inputs changed. Generate a new plan to see an updated route and logs.');
    invalidate();
  }

  async function generate(input: TripInput) {
    if (!bootstrap || submitting.current) return;
    submitting.current = true;
    const currentVersion = ++version.current;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setTrip(null);
    setError(null);
    setNotice('');
    try {
      const result = await api.trip(input, bootstrap.csrf_token, controller.signal);
      if (currentVersion !== version.current || controller.signal.aborted) return;
      setTrip(result);
      setNotice('Your projected trip plan is ready.');
      requestAnimationFrame(() => {
        if (currentVersion === version.current)
          resultHeading.current?.focus({ preventScroll: true });
      });
    } catch (failure) {
      if (currentVersion !== version.current || controller.signal.aborted) return;
      setError(
        failure instanceof ApiError
          ? failure.detail
          : {
              code: 'unexpected_error',
              message: errorMessage(failure),
              fields: {},
              request_id: '',
            },
      );
    } finally {
      if (currentVersion === version.current) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  return {
    bootstrap,
    bootstrapError,
    bootLoading,
    trip,
    busy,
    error,
    notice,
    resultHeading,
    edit,
    generate,
    cancel: () => {
      invalidate();
      setNotice('Planning cancelled. Your inputs have been kept.');
    },
    reload: () => {
      invalidate();
      setBootstrap(null);
      setNotice('Refreshing planning context. Your inputs have been kept.');
      setRevision((value) => value + 1);
    },
  };
}
