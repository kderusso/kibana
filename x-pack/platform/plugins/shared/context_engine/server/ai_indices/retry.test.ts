/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { loggingSystemMock } from '@kbn/core/server/mocks';
import { setTimeout } from 'timers/promises';
import { retryTransientEsErrors } from './retry';

jest.mock('timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

const setTimeoutMock = setTimeout as jest.MockedFunction<typeof setTimeout>;

describe('retryTransientEsErrors', () => {
  const logger = loggingSystemMock.createLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the result without retrying when the call succeeds', async () => {
    const esCall = jest.fn().mockResolvedValue('ok');

    await expect(retryTransientEsErrors(esCall, { logger })).resolves.toBe('ok');
    expect(esCall).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });

  it('retries transient errors with exponential backoff and eventually resolves', async () => {
    const esCall = jest
      .fn()
      .mockRejectedValueOnce(new errors.ConnectionError('unavailable'))
      .mockRejectedValueOnce(new errors.ConnectionError('unavailable'))
      .mockResolvedValue('ok');

    await expect(retryTransientEsErrors(esCall, { logger })).resolves.toBe('ok');
    expect(esCall).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    // 2s then 4s backoff (in milliseconds).
    expect(setTimeoutMock.mock.calls.map(([delay]) => delay)).toEqual([2000, 4000]);
  });

  it('rethrows non-retryable errors immediately without retrying', async () => {
    const badRequest = new errors.ResponseError({
      statusCode: 400,
      warnings: [],
      meta: {} as any,
      body: 'illegal_argument_exception',
    });
    const esCall = jest.fn().mockRejectedValue(badRequest);

    await expect(retryTransientEsErrors(esCall, { logger })).rejects.toBe(badRequest);
    expect(esCall).toHaveBeenCalledTimes(1);
    expect(setTimeoutMock).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stops retrying after the maximum number of attempts', async () => {
    const esCall = jest.fn().mockRejectedValue(new errors.ConnectionError('unavailable'));

    await expect(retryTransientEsErrors(esCall, { logger })).rejects.toThrow('unavailable');
    // Initial attempt + 5 retries.
    expect(esCall).toHaveBeenCalledTimes(6);
    // Backoff caps at 64s: 2s, 4s, 8s, 16s, 32s.
    expect(setTimeoutMock.mock.calls.map(([delay]) => delay)).toEqual([
      2000, 4000, 8000, 16000, 32000,
    ]);
  });
});
