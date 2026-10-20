import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { applyFieldErrors } from '../form';

function validationFailed(fields: { field: string; message: string }[]): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    status: 422,
    statusText: '',
    headers: {},
    config,
    data: { success: false, error: { code: 'VALIDATION_FAILED', message: 'Please check these fields', fields } },
  });
}

type Form = { firstName: string; email: string };

describe('applyFieldErrors', () => {
  it("puts each server message on the form's own field", () => {
    const setError = vi.fn();
    const applied = applyFieldErrors<Form>(
      validationFailed([
        { field: 'firstName', message: 'First name must be at least 2 characters' },
        { field: 'body', message: 'not a form field' },
      ]),
      setError,
      ['firstName', 'email'],
    );
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('firstName', { type: 'server', message: 'First name must be at least 2 characters' });
  });

  it('sets nothing for fields the form does not have, or for any other error', () => {
    const setError = vi.fn();
    expect(applyFieldErrors<Form>(validationFailed([{ field: 'body', message: 'x' }]), setError, ['firstName'])).toBe(false);
    expect(applyFieldErrors<Form>(new Error('boom'), setError, ['firstName'])).toBe(false);
    expect(applyFieldErrors<Form>(null, setError, ['firstName'])).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
